import hashlib
import json
import os
import threading
import time
from contextlib import asynccontextmanager
from collections import defaultdict, deque
from datetime import timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import FastAPI, Depends, HTTPException, Request, Response, Query
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select, func, delete
from starlette.middleware.sessions import SessionMiddleware
from authlib.integrations.starlette_client import OAuth
from .i18n import tr, tr_message
from .db_errors import diagnostic
from .models import (
    Base,
    engine,
    Session,
    User,
    Source,
    Grant,
    Snapshot,
    Job,
    Note,
    Audit,
    LoginSession,
    SourceMetadata,
    ScanSchedule,
    SearchEntry,
    WarehouseProject,
    WarehouseProjectSource,
    ApplicationBranding,
    SourceAnalysis,
    SourceProfile,
    now,
)
from .security import (
    hasher,
    encrypt,
    decrypt,
    current,
    require_admin,
    access,
    audit,
    issue_session,
    user_json,
    ad_auth,
)
from .connectors import validate_config, connection_test, preview, KINDS
from .jobs import (
    scan_lock,
    enqueue,
    dispatch,
    start_workers,
    stop_workers,
    next_due,
    schedule_json,
)
from .search import migrate, reindex_source
from .schema_diff import compare
from .warehouse_api import router as warehouse_router
from .design_tools import router as design_tools_router
from .branding import router as branding_router
from .warehouse_workspace import router as warehouse_workspace_router
from .catalog_tags import (
    router as catalog_tags_router,
    styles_for,
    definitions,
    normalize_tags,
)
from .analysis_api import router as analysis_router
from .business_catalog import (
    router as business_catalog_router,
    uses_source as business_uses_source,
)

from .i18n import LANGUAGE, MESSAGES, negotiate_language

APP_URL = os.environ.get("APP_URL", "http://localhost:8090").rstrip("/")
login_lock = threading.Lock()
login_attempts = defaultdict(deque)


@asynccontextmanager
async def lifespan(app):
    Base.metadata.create_all(engine)
    with Session() as db:
        if not db.scalar(select(func.count()).select_from(User)):
            password = os.environ["ADMIN_PASSWORD"]
            if len(password) < 12 or password.startswith("CHANGE_ME"):
                raise RuntimeError(
                    "ADMIN_PASSWORD muss ein individuelles Passwort mit mindestens 12 Zeichen sein."
                )
            db.add(
                User(
                    username=os.getenv("ADMIN_USERNAME", "admin"),
                    display_name="Administrator",
                    password_hash=hasher.hash(password),
                    role="admin",
                )
            )
        for job in db.scalars(select(Job).where(Job.status.in_(["queued", "running"]))):
            job.status = "failed"
            job.message = tr("Scan durch Neustart unterbrochen. Bitte erneut starten.")
            job.finished = now()
        db.commit()
    with Session() as db:
        migrate(db)
    start_workers()
    try:
        yield
    finally:
        stop_workers()


app = FastAPI(
    title="DatabaseDoc",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
)
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ["SESSION_SECRET"],
    same_site="lax",
    https_only=os.getenv("COOKIE_SECURE", "true") == "true",
    max_age=600,
    session_cookie="datatlas_oidc",
)


@app.get("/api/i18n/en.js", include_in_schema=False)
def english_catalog():
    return Response(
        "const UI_TRANSLATIONS = " + json.dumps(MESSAGES, ensure_ascii=False) + ";",
        media_type="application/javascript",
        headers={"Cache-Control": "public, max-age=0, must-revalidate"},
    )


app.include_router(warehouse_router)
app.include_router(branding_router)
app.include_router(warehouse_workspace_router)
app.include_router(catalog_tags_router)
app.include_router(design_tools_router)
app.include_router(analysis_router)
app.include_router(business_catalog_router)
app.mount("/static", StaticFiles(directory="app/static"), name="static")
oauth = OAuth()
if (
    os.getenv("ENTRA_TENANT_ID")
    and os.getenv("ENTRA_CLIENT_ID")
    and os.getenv("ENTRA_CLIENT_SECRET")
):
    oauth.register(
        "entra",
        client_id=os.environ["ENTRA_CLIENT_ID"],
        client_secret=os.environ["ENTRA_CLIENT_SECRET"],
        server_metadata_url=f'https://login.microsoftonline.com/{os.environ["ENTRA_TENANT_ID"]}/v2.0/.well-known/openid-configuration',
        client_kwargs={"scope": "openid profile email"},
    )


def origin_check(request):
    origin = request.headers.get("origin")
    if origin and origin != APP_URL:
        raise HTTPException(403, tr("Unerlaubter Ursprung."))


@app.middleware("http")
async def headers(request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        if request.headers.get("origin") and request.headers["origin"] != APP_URL:
            return JSONResponse(
                {"detail": tr("Unerlaubter Ursprung.")}, status_code=403
            )
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"
    )
    if request.url.path.startswith("/api/") or request.url.path.startswith("/auth/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.middleware("http")
async def localized_request(request: Request, call_next):
    token = LANGUAGE.set(negotiate_language(request.headers.get("accept-language")))
    try:
        response = await call_next(request)
        response.headers["Content-Language"] = LANGUAGE.get()
        return response
    finally:
        LANGUAGE.reset(token)


@app.get("/")
def index():
    return FileResponse("app/static/index.html")


@app.get("/api/health")
def health():
    with engine.connect() as conn:
        from sqlalchemy import text

        conn.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/api/auth/options")
def options():
    return {
        "entra": oauth.create_client("entra") is not None,
        "ad": bool(os.getenv("LDAP_HOST")),
    }


class LoginInput(BaseModel):
    username: str = Field(min_length=1, max_length=190)
    password: str = Field(min_length=1, max_length=1024)
    provider: Literal["local", "ad"] = "local"


@app.post("/api/auth/login")
def login(body: LoginInput, request: Request, response: Response):
    key = request.client.host
    with login_lock:
        attempts = login_attempts[key]
        cutoff = time.monotonic() - 300
        while attempts and attempts[0] < cutoff:
            attempts.popleft()
        if len(attempts) >= 10:
            raise HTTPException(
                429,
                tr("Zu viele Anmeldeversuche. Bitte in fünf Minuten erneut versuchen."),
            )
        attempts.append(time.monotonic())
    with Session() as db:
        user = None
        if body.provider == "local":
            user = db.scalar(
                select(User).where(
                    User.username == body.username, User.identity.is_(None)
                )
            )
            valid = False
            # A dummy hash keeps unknown usernames comparable to valid users.
            try:
                valid = hasher.verify(
                    user.password_hash if user and user.password_hash else DUMMY_HASH,
                    body.password,
                )
            except Exception:
                pass
            if not valid:
                user = None
        elif os.getenv("LDAP_HOST"):
            try:
                info = ad_auth(body.username, body.password)
                if info:
                    user = provision(db, info)
            except Exception:
                user = None
        if not user or not user.active:
            audit(db, body.username, "login_failed")
            db.commit()
            raise HTTPException(401, tr("Anmeldung fehlgeschlagen."))
        csrf = issue_session(db, user, response)
        return {"user": user_json(user), "csrf": csrf}


DUMMY_HASH = hasher.hash("unused-dummy-password")


def provision(db, info):
    user = db.scalar(select(User).where(User.identity == info["identity"]))
    if not user:
        user = User(**info, role="viewer")
        db.add(user)
        db.flush()
    return user


@app.get("/auth/entra")
async def entra_start(request: Request):
    client = oauth.create_client("entra")
    if not client:
        raise HTTPException(404, tr("Entra ID ist noch nicht eingerichtet."))
    return await client.authorize_redirect(request, APP_URL + "/auth/entra/callback")


@app.get("/auth/entra/callback")
async def entra_callback(request: Request):
    client = oauth.create_client("entra")
    if not client:
        raise HTTPException(404, tr("Entra ID ist noch nicht eingerichtet."))
    try:
        token = await client.authorize_access_token(request)
        claims = token["userinfo"]
        if claims.get("tid") != os.environ["ENTRA_TENANT_ID"] or not claims.get("oid"):
            raise ValueError("Falscher Tenant")
        identity = "entra:" + claims["tid"] + ":" + claims["oid"]
        with Session() as db:
            user = provision(
                db,
                {
                    "identity": identity,
                    "username": "entra:" + claims["oid"],
                    "display_name": str(claims.get("name", tr("Entra-Benutzer")))[:190],
                },
            )
            if not user.active:
                raise ValueError(tr("Konto deaktiviert"))
            response = RedirectResponse("/")
            issue_session(db, user, response)
            request.session.clear()
            return response
    except Exception:
        request.session.clear()
        return RedirectResponse("/?auth_error=1")


@app.get("/api/auth/me")
def me(request: Request, user: User = Depends(current)):
    with Session() as db:
        session = db.get(
            LoginSession,
            hashlib.sha256(request.cookies["datatlas_session"].encode()).hexdigest(),
        )
        return {"user": user_json(user), "csrf": session.csrf}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, user: User = Depends(current)):
    with Session() as db:
        db.execute(
            delete(LoginSession).where(
                LoginSession.token_hash
                == hashlib.sha256(
                    request.cookies["datatlas_session"].encode()
                ).hexdigest()
            )
        )
        audit(db, user, "logout")
        db.commit()
    response.delete_cookie("datatlas_session", path="/")
    return {"ok": True}


class PasswordInput(BaseModel):
    current_password: str
    password: str = Field(min_length=12, max_length=1024)


@app.post("/api/auth/password")
def password(
    body: PasswordInput,
    request: Request,
    response: Response,
    user: User = Depends(current),
):
    with Session() as db:
        record = db.get(User, user.id)
        try:
            if record.identity or not hasher.verify(
                record.password_hash, body.current_password
            ):
                raise ValueError()
        except Exception:
            raise HTTPException(
                400,
                tr("Aktuelles Passwort ist falsch oder Konto ist extern verwaltet."),
            )
        record.password_hash = hasher.hash(body.password)
        db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
        audit(db, user, "password_changed")
        csrf = issue_session(db, record, response)
        return {"csrf": csrf}


class SourceInput(BaseModel):
    name: str = Field(min_length=1, max_length=190)
    kind: Literal["mssql", "mysql", "mariadb", "postgresql", "mongodb", "sqlite"]
    host: str = Field(default="", max_length=253)
    port: int | None = Field(default=None, ge=1, le=65535)
    database: str = Field(default="", max_length=190)
    schema_name: str = Field(default="", max_length=190)
    username: str = Field(default="", max_length=190)
    password: str | None = Field(default=None, max_length=1024)
    path: str = Field(default="", max_length=500)
    tls: bool = True
    auth_source: str = Field(default="", max_length=190)
    mongo_infer: bool = False


def cfg(body, old=None):
    data = body.model_dump(exclude={"name", "kind", "mongo_infer", "schema_name"})
    data["schema"] = body.schema_name
    if body.password is None:
        data["password"] = (old or {}).get("password", "")
    try:
        validate_config(body.kind, data)
    except (ValueError, TypeError) as error:
        raise HTTPException(422, str(error))
    return data


def latest(db, source_id):
    return db.scalar(
        select(Snapshot)
        .where(Snapshot.source_id == source_id)
        .order_by(Snapshot.id.desc())
        .limit(1)
    )


def warehouse_uses_source(db, source_id):
    return bool(
        db.scalar(
            select(WarehouseProjectSource.project_id).where(
                WarehouseProjectSource.source_id == source_id
            )
        )
        or db.scalar(
            select(WarehouseProject.id).where(
                WarehouseProject.target_source_id == source_id
            )
        )
    )


def source_json(db, source, user, tag_definitions=None):
    config = decrypt(source)
    metadata = db.get(SourceMetadata, source.id)
    schedule = db.get(ScanSchedule, source.id)
    snap = latest(db, source.id)
    job = db.scalar(
        select(Job).where(Job.source_id == source.id).order_by(Job.id.desc()).limit(1)
    )
    grant = db.scalar(
        select(Grant).where(Grant.source_id == source.id, Grant.user_id == user.id)
    )
    editable = user.role == "admin" or (user.role == "editor" and grant and grant.edit)
    visible_config = (
        {k: v for k, v in config.items() if k != "password"}
        if editable
        else {
            k: v
            for k, v in config.items()
            if k in {"host", "port", "database", "schema", "path"}
        }
    )
    return {
        "id": source.id,
        "name": source.name,
        "kind": source.kind,
        "config": visible_config,
        "mongo_infer": source.mongo_infer,
        "tags": metadata.tags if metadata else [],
        "tag_styles": styles_for(
            db, metadata.tags if metadata else [], tag_definitions
        ),
        "owner": metadata.owner if metadata else "",
        "owner_email": metadata.owner_email if metadata else "",
        "schedule": schedule_json(schedule),
        "can_edit": bool(editable),
        "can_data": user.role == "admin" or bool(grant and grant.data),
        "snapshot_id": snap.id if snap else None,
        "scanned_at": snap.created if snap else None,
        "table_count": len(snap.payload["tables"]) if snap else 0,
        "column_count": (
            sum(len(t["columns"]) for t in snap.payload["tables"]) if snap else 0
        ),
        "relation_count": (
            sum(len(t["foreign_keys"]) for t in snap.payload["tables"]) if snap else 0
        ),
        "job": (
            {"id": job.id, "status": job.status, "message": tr_message(job.message)}
            if job
            else None
        ),
    }


@app.get("/api/sources")
def sources(user: User = Depends(current)):
    with Session() as db:
        query = select(Source).order_by(Source.name)
        if user.role != "admin":
            query = query.join(Grant).where(Grant.user_id == user.id)
        known_tags = definitions(db)
        return [source_json(db, s, user, known_tags) for s in db.scalars(query)]


@app.post("/api/sources")
def create_source(body: SourceInput, user: User = Depends(current)):
    require_admin(user)
    config = cfg(body)
    with Session() as db:
        source = Source(
            name=body.name,
            kind=body.kind,
            config_encrypted=encrypt(config),
            mongo_infer=body.mongo_infer,
        )
        db.add(source)
        db.flush()
        audit(db, user, "source_created", source.id)
        db.commit()
        return source_json(db, source, user)


@app.put("/api/sources/{source_id}")
def update_source(source_id: int, body: SourceInput, user: User = Depends(current)):
    with scan_lock, Session() as db:
        source = access(db, user, source_id, edit=True)
        if db.scalar(
            select(Job).where(
                Job.source_id == source_id, Job.status.in_(["queued", "running"])
            )
        ):
            raise HTTPException(409, tr("Bitte laufenden Scan abwarten."))
        previous = decrypt(source)
        updated = cfg(body, previous)
        target_changed = source.kind != body.kind or any(
            previous.get(k) != updated.get(k)
            for k in ("host", "port", "database", "schema", "path")
        )
        if target_changed and warehouse_uses_source(db, source_id):
            raise HTTPException(
                409,
                tr(
                    "Diese Quelle gehört zu einem DWH-Projekt. Für eine andere Datenbank bitte eine neue Datenquelle anlegen oder zuerst die Projektzuordnungen entfernen."
                ),
            )
        if target_changed and business_uses_source(db, source_id):
            raise HTTPException(
                409,
                tr(
                    "Diese Quelle hat fachliche Feldzuordnungen. Zuerst die Zuordnungen entfernen oder eine neue Datenquelle anlegen."
                ),
            )
        source.name = body.name
        source.config_encrypted = encrypt(updated)
        source.kind = body.kind
        source.mongo_infer = body.mongo_infer
        # A different target must not inherit the previous target's documentation.
        if target_changed:
            db.execute(
                delete(SourceProfile).where(SourceProfile.source_id == source_id)
            )
            db.execute(
                delete(SourceAnalysis).where(SourceAnalysis.source_id == source_id)
            )
            db.execute(delete(Snapshot).where(Snapshot.source_id == source_id))
            db.execute(delete(Note).where(Note.source_id == source_id))
        reindex_source(db, source)
        audit(db, user, "source_updated", source_id)
        db.commit()
        return source_json(db, source, user)


@app.delete("/api/sources/{source_id}")
def delete_source(source_id: int, user: User = Depends(current)):
    require_admin(user)
    with scan_lock, Session() as db:
        source = access(db, user, source_id)
        if db.scalar(
            select(Job).where(
                Job.source_id == source_id, Job.status.in_(["queued", "running"])
            )
        ):
            raise HTTPException(409, tr("Bitte laufenden Scan abwarten."))
        if warehouse_uses_source(db, source_id):
            raise HTTPException(
                409,
                tr(
                    "Diese Datenquelle gehört zu einem DWH-Projekt. Bitte zuerst die Projektzuordnungen entfernen."
                ),
            )
        if business_uses_source(db, source_id):
            raise HTTPException(
                409,
                tr(
                    "Diese Quelle hat fachliche Feldzuordnungen. Zuerst die Zuordnungen entfernen oder eine neue Datenquelle anlegen."
                ),
            )
        for model in (
            SourceProfile,
            SourceAnalysis,
            SearchEntry,
            ScanSchedule,
            SourceMetadata,
            Grant,
            Snapshot,
            Job,
            Note,
        ):
            db.execute(delete(model).where(model.source_id == source_id))
        db.delete(source)
        audit(db, user, "source_deleted", source_id)
        db.commit()
    return {"ok": True}


@app.post("/api/sources/test")
def test_unsaved(body: SourceInput, user: User = Depends(current)):
    require_admin(user)
    return do_test(body.kind, cfg(body))


@app.post("/api/sources/{source_id}/test")
def test_saved(source_id: int, user: User = Depends(current)):
    with Session() as db:
        source = access(db, user, source_id, edit=True)
        return do_test(source.kind, decrypt(source))


def do_test(kind, config):
    try:
        connection_test(kind, config)
        return {"ok": True, "message": tr("Verbindung erfolgreich.")}
    except Exception as error:
        raise HTTPException(
            400,
            diagnostic(kind, error, "test"),
        )


@app.post("/api/sources/{source_id}/scan", status_code=202)
def start_scan(source_id: int, user: User = Depends(current)):
    with scan_lock, Session() as db:
        job = enqueue(db, source_id, user)
        db.commit()
        dispatch(job.id)
        return {"id": job.id, "status": "queued"}


@app.get("/api/sources/{source_id}/snapshot")
def snapshot(
    source_id: int, snapshot_id: int | None = None, user: User = Depends(current)
):
    with Session() as db:
        access(db, user, source_id)
        snap = db.get(Snapshot, snapshot_id) if snapshot_id else latest(db, source_id)
        if not snap or snap.source_id != source_id:
            raise HTTPException(
                404, tr("Noch keine Dokumentation vorhanden. Bitte Scan starten.")
            )
        notes = {
            n.table_key: n.text
            for n in db.scalars(select(Note).where(Note.source_id == source_id))
        }
        return {
            "id": snap.id,
            "created": snap.created,
            "payload": snap.payload,
            "notes": notes,
        }


@app.get("/api/sources/{source_id}/history")
def history(source_id: int, user: User = Depends(current)):
    with Session() as db:
        access(db, user, source_id)
        return [
            {"id": s.id, "created": s.created, "table_count": len(s.payload["tables"])}
            for s in db.scalars(
                select(Snapshot)
                .where(Snapshot.source_id == source_id)
                .order_by(Snapshot.id.desc())
                .limit(100)
            )
        ]


class PreviewInput(BaseModel):
    table_key: str = Field(max_length=350)


@app.post("/api/sources/{source_id}/preview")
def data_preview(source_id: int, body: PreviewInput, user: User = Depends(current)):
    with Session() as db:
        source = access(db, user, source_id, data=True)
        snap = latest(db, source_id)
        table = (
            next(
                (t for t in snap.payload["tables"] if t["key"] == body.table_key), None
            )
            if snap
            else None
        )
        if not table:
            raise HTTPException(404, tr("Objekt nicht im aktuellen Schema gefunden."))
        audit(db, user, "data_preview", f'{source_id}:{table["name"]}'[:190])
        db.commit()
        try:
            return preview(source.kind, decrypt(source), table)
        except Exception as error:
            raise HTTPException(
                400,
                tr(
                    "Datenvorschau fehlgeschlagen ({0}). Leserechte prüfen und Schema erneut scannen.",
                    type(error).__name__,
                ),
            )


class NoteInput(BaseModel):
    table_key: str = Field(max_length=350)
    text: str = Field(max_length=20000)


@app.put("/api/sources/{source_id}/notes")
def save_note(source_id: int, body: NoteInput, user: User = Depends(current)):
    with scan_lock, Session() as db:
        source = access(db, user, source_id, edit=True)
        snap = latest(db, source_id)
        if not snap or not any(
            t["key"] == body.table_key for t in snap.payload["tables"]
        ):
            raise HTTPException(404, tr("Objekt nicht im aktuellen Schema gefunden."))
        note = db.scalar(
            select(Note).where(
                Note.source_id == source_id, Note.table_key == body.table_key
            )
        )
        if note:
            note.text = body.text
        else:
            db.add(Note(source_id=source_id, table_key=body.table_key, text=body.text))
        reindex_source(db, source)
        audit(db, user, "note_updated", source_id)
        db.commit()
    return {"ok": True}


@app.get("/api/sources/{source_id}/export")
def export(
    source_id: int,
    format: Literal["json", "markdown", "pdf", "er_pdf"] = "json",
    snapshot_id: int | None = None,
    table_key: str | None = Query(default=None, max_length=4096),
    user: User = Depends(current),
):
    with Session() as db:
        source = access(db, user, source_id)
        snap = (
            db.get(Snapshot, snapshot_id)
            if snapshot_id is not None
            else latest(db, source_id)
        )
        if not snap or snap.source_id != source_id:
            raise HTTPException(404, tr("Noch keine Dokumentation vorhanden."))
        tables = snap.payload["tables"]
        if table_key is not None:
            if format != "pdf":
                raise HTTPException(
                    422,
                    tr("Einzelne Objekte können als Tabellen-PDF exportiert werden."),
                )
            tables = [t for t in tables if t["key"] == table_key]
            if not tables:
                raise HTTPException(
                    404, tr("Objekt nicht im gewählten Schema gefunden.")
                )
        notes = {
            n.table_key: n.text
            for n in db.scalars(select(Note).where(Note.source_id == source_id))
        }
        payload = {
            "source": {
                "name": source.name,
                "kind": source.kind,
                **metadata_json(db.get(SourceMetadata, source_id)),
            },
            "snapshot_id": snap.id,
            "created": snap.created.isoformat() + "Z",
            "schema": snap.payload,
            "notes": notes,
        }
        if format in {"pdf", "er_pdf"}:
            from .pdf_export import tables_pdf, er_pdf

            branding = db.get(ApplicationBranding, 1)
            logo = branding.logo if branding else None
            content = (
                tables_pdf(payload, tables, logo)
                if format == "pdf"
                else er_pdf(payload, logo)
            )
            audit(db, user, "documentation_export", source_id)
            db.commit()
            suffix = (
                "er"
                if format == "er_pdf"
                else "table" if table_key is not None else "tables"
            )
            return Response(
                content,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f'attachment; filename="databasedoc-{source_id}-{suffix}.pdf"'
                },
            )
        audit(db, user, "documentation_export", source_id)
        db.commit()
        if format == "json":
            return Response(
                json.dumps(payload, ensure_ascii=False, indent=2, default=str),
                media_type="application/json",
                headers={
                    "Content-Disposition": f'attachment; filename="databasedoc-{source_id}.json"'
                },
            )

        def cell(value):
            return str(value or "").replace("|", "\\|").replace("\n", " ")

        lines = [
            f"# {source.name}",
            tr("\nTyp: {0} · Stand: {1} UTC\n", source.kind, snap.created.isoformat()),
        ]
        organization = payload["source"]
        lines += [
            f"Tags: {cell(", ".join(organization["tags"]))}",
            f"Owner: {cell(organization["owner"])} {cell(organization["owner_email"])}",
            "",
        ]
        for warning in snap.payload.get("warnings", []):
            warning = tr_message(warning)
            lines.append("> " + warning + "\n")
        for t in snap.payload["tables"]:
            lines += [
                f'## {t["schema"]+"." if t["schema"] else ""}{t["name"]}',
                t.get("comment") or "",
                notes.get(t["key"], ""),
                "",
                tr("| Spalte | Typ | NULL | PK | Standard |"),
                "|---|---|---|---|---|",
            ]
            lines += [
                f'| {cell(c["name"])} | {cell(c["type"])} | {"Ja" if c["nullable"] else "Nein"} | {"Ja" if c["primary_key"] else ""} | {cell(c["default"])} |'
                for c in t["columns"]
            ]
            for f in t["foreign_keys"]:
                lines.append(
                    f'\nFK {", ".join(f["columns"])} → {f["target_schema"]}.{f["target_table"]} ({", ".join(f["target_columns"])})'
                )
            lines += [
                tr("\nIndizes: ")
                + ", ".join(
                    (i["name"] or "")
                    + " ("
                    + ", ".join(str(c) for c in i["columns"])
                    + ")"
                    for i in t["indexes"]
                ),
                "",
            ]
        return Response(
            "\n".join(lines),
            media_type="text/markdown",
            headers={
                "Content-Disposition": f'attachment; filename="databasedoc-{source_id}.md"'
            },
        )


class UserInput(BaseModel):
    username: str = Field(min_length=1, max_length=190, pattern=r"^[a-zA-Z0-9_.@-]+$")
    display_name: str = Field(min_length=1, max_length=190)
    password: str = Field(min_length=12, max_length=1024)
    role: Literal["admin", "editor", "viewer"] = "viewer"


class UserUpdate(BaseModel):
    role: Literal["admin", "editor", "viewer"]
    active: bool = True


@app.get("/api/users")
def users(user: User = Depends(current)):
    require_admin(user)
    with Session() as db:
        return [user_json(u) for u in db.scalars(select(User).order_by(User.username))]


@app.post("/api/users")
def add_user(body: UserInput, user: User = Depends(current)):
    require_admin(user)
    with Session() as db:
        if db.scalar(select(User).where(User.username == body.username)):
            raise HTTPException(409, tr("Benutzername ist bereits vergeben."))
        created = User(
            username=body.username,
            display_name=body.display_name,
            password_hash=hasher.hash(body.password),
            role=body.role,
        )
        db.add(created)
        db.flush()
        audit(db, user, "user_created", created.id)
        db.commit()
        return user_json(created)


@app.put("/api/users/{user_id}")
def edit_user(user_id: int, body: UserUpdate, user: User = Depends(current)):
    require_admin(user)
    with Session() as db:
        record = db.get(User, user_id)
        if not record:
            raise HTTPException(404, tr("Benutzer nicht gefunden."))
        if record.id == user.id and (body.role != "admin" or not body.active):
            raise HTTPException(
                400,
                tr(
                    "Das eigene Administratorkonto kann nicht herabgestuft oder deaktiviert werden."
                ),
            )
        record.role = body.role
        record.active = body.active
        db.execute(delete(LoginSession).where(LoginSession.user_id == record.id))
        audit(db, user, "user_updated", user_id)
        db.commit()
        return user_json(record)


class GrantInput(BaseModel):
    user_id: int
    edit: bool = False
    data: bool = False


@app.get("/api/sources/{source_id}/grants")
def grants(source_id: int, user: User = Depends(current)):
    require_admin(user)
    with Session() as db:
        access(db, user, source_id)
        return [
            {"user_id": g.user_id, "edit": g.edit, "data": g.data}
            for g in db.scalars(select(Grant).where(Grant.source_id == source_id))
        ]


@app.put("/api/sources/{source_id}/grants")
def set_grant(source_id: int, body: GrantInput, user: User = Depends(current)):
    require_admin(user)
    with Session() as db:
        access(db, user, source_id)
        if not db.get(User, body.user_id):
            raise HTTPException(404, tr("Benutzer nicht gefunden."))
        grant = db.scalar(
            select(Grant).where(
                Grant.source_id == source_id, Grant.user_id == body.user_id
            )
        )
        if grant:
            grant.edit = body.edit
            grant.data = body.data
        else:
            db.add(
                Grant(
                    source_id=source_id,
                    user_id=body.user_id,
                    edit=body.edit,
                    data=body.data,
                )
            )
        audit(db, user, "grant_updated", f"{source_id}:{body.user_id}")
        db.commit()
    return {"ok": True}


@app.delete("/api/sources/{source_id}/grants/{user_id}")
def revoke(source_id: int, user_id: int, user: User = Depends(current)):
    require_admin(user)
    with Session() as db:
        access(db, user, source_id)
        db.execute(
            delete(Grant).where(Grant.source_id == source_id, Grant.user_id == user_id)
        )
        audit(db, user, "grant_revoked", f"{source_id}:{user_id}")
        db.commit()
    return {"ok": True}


@app.get("/api/audit")
def audit_events(user: User = Depends(current)):
    require_admin(user)
    with Session() as db:
        return [
            {
                "id": e.id,
                "user": e.user,
                "action": e.action,
                "target": e.target,
                "created": e.created,
            }
            for e in db.scalars(select(Audit).order_by(Audit.id.desc()).limit(200))
        ]


@app.post("/api/sources/{source_id}/test-config")
def test_config(source_id: int, body: SourceInput, user: User = Depends(current)):
    with Session() as db:
        source = access(db, user, source_id, edit=True)
        return do_test(body.kind, cfg(body, decrypt(source)))


@app.post("/api/sources/discover")
def discover(body: SourceInput, user: User = Depends(current)):
    require_admin(user)
    return do_discover(body)


@app.post("/api/sources/{source_id}/discover")
def discover_saved(source_id: int, body: SourceInput, user: User = Depends(current)):
    with Session() as db:
        source = access(db, user, source_id, edit=True)
        return do_discover(body, decrypt(source))


def do_discover(body, old=None):
    from .connectors import discover_databases

    config = body.model_dump(exclude={"name", "kind", "mongo_infer", "schema_name"})
    if body.password is None:
        config["password"] = (old or {}).get("password", "")
    try:
        return {"databases": discover_databases(body.kind, config)}
    except Exception as error:
        raise HTTPException(
            400,
            tr(
                "Datenbankliste konnte nicht geladen werden ({0}). Verbindung und Berechtigungen prüfen oder Datenbankname direkt eingeben.",
                type(error).__name__,
            ),
        )


def metadata_json(metadata):
    return {
        "tags": metadata.tags if metadata else [],
        "owner": metadata.owner if metadata else "",
        "owner_email": metadata.owner_email if metadata else "",
    }


class MetadataInput(BaseModel):
    tags: list[str] = Field(default_factory=list, max_length=20)
    owner: str = Field(default="", max_length=190)
    owner_email: str = Field(default="", max_length=190)


@app.put("/api/sources/{source_id}/metadata")
def save_metadata(source_id: int, body: MetadataInput, user: User = Depends(current)):
    tags = normalize_tags(body.tags)
    email = body.owner_email.strip()
    if email and (
        email.count("@") != 1
        or any(c.isspace() for c in email)
        or not all(email.split("@"))
    ):
        raise HTTPException(422, tr("Bitte eine gültige E-Mail-Adresse angeben."))
    with scan_lock, Session() as db:
        access(db, user, source_id, edit=True)
        record = db.get(SourceMetadata, source_id)
        if not record:
            record = SourceMetadata(source_id=source_id)
            db.add(record)
        record.tags = tags
        record.owner = body.owner.strip()
        record.owner_email = email
        audit(db, user, "source_metadata_updated", source_id)
        db.commit()
        return {**metadata_json(record), "tag_styles": styles_for(db, record.tags)}


class ScheduleInput(BaseModel):
    enabled: bool = False
    cadence: Literal["hourly", "daily", "weekly"] = "daily"
    hour: int = Field(default=2, ge=0, le=23)
    minute: int = Field(default=0, ge=0, le=59)
    weekday: int = Field(default=0, ge=0, le=6)
    timezone: str = Field(default="Europe/Berlin", min_length=1, max_length=64)


@app.get("/api/sources/{source_id}/schedule")
def get_schedule(source_id: int, user: User = Depends(current)):
    with Session() as db:
        access(db, user, source_id)
        return schedule_json(db.get(ScanSchedule, source_id))


@app.put("/api/sources/{source_id}/schedule")
def save_schedule(source_id: int, body: ScheduleInput, user: User = Depends(current)):
    try:
        ZoneInfo(body.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, tr("Unbekannte Zeitzone. Beispiel: Europe/Berlin."))
    with scan_lock, Session() as db:
        access(db, user, source_id, edit=True)
        record = db.get(ScanSchedule, source_id)
        if not record:
            record = ScanSchedule(source_id=source_id)
            db.add(record)
        for field, value in body.model_dump().items():
            setattr(record, field, value)
        record.created_by_id = user.id
        record.next_run = next_due(record, now()) if record.enabled else None
        record.message = (
            "Zeitplan aktiv." if record.enabled else "Automatische Scans deaktiviert."
        )
        audit(db, user, "scan_schedule_updated", source_id)
        db.commit()
        return schedule_json(record)


@app.get("/api/sources/{source_id}/compare")
def compare_snapshots(
    source_id: int, before: int, after: int, user: User = Depends(current)
):
    with Session() as db:
        access(db, user, source_id)
        old, new = db.get(Snapshot, before), db.get(Snapshot, after)
        if (
            not old
            or not new
            or old.source_id != source_id
            or new.source_id != source_id
        ):
            raise HTTPException(
                404, tr("Schema-Stand nicht für diese Datenquelle gefunden.")
            )
        if before >= after:
            raise HTTPException(
                422, tr("Der Ausgangsstand muss älter als der Vergleichsstand sein.")
            )
        return {
            "before": {"id": old.id, "created": old.created},
            "after": {"id": new.id, "created": new.created},
            **compare(old.payload, new.payload),
        }


@app.get("/api/search")
def global_search(
    q: str = "",
    source_id: int | None = None,
    kind: Literal["all", "table", "column", "note"] = "all",
    page: int = 1,
    page_size: int = 50,
    user: User = Depends(current),
):
    if (
        len(q.strip()) < 2
        or len(q) > 200
        or page < 1
        or page_size < 1
        or page_size > 100
    ):
        raise HTTPException(422, tr("Suchbegriff: 2–200 Zeichen. Seitengröße: 1–100."))
    terms = q.casefold().split()
    with Session() as db:
        query = select(SearchEntry, Source).join(
            Source, Source.id == SearchEntry.source_id
        )
        if user.role != "admin":
            query = query.join(Grant, Grant.source_id == Source.id).where(
                Grant.user_id == user.id
            )
        if source_id is not None:
            access(db, user, source_id)
            query = query.where(Source.id == source_id)
        if kind != "all":
            query = query.where(SearchEntry.kind == kind)
        for term in terms:
            literal = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            query = query.where(SearchEntry.content.like(f"%{literal}%", escape="\\"))
        total = db.scalar(select(func.count()).select_from(query.subquery()))
        rows = db.execute(
            query.order_by(
                Source.name, SearchEntry.title, SearchEntry.kind, SearchEntry.id
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        results = []
        for entry, source in rows:
            start = max(0, entry.content.find(terms[0]) - 60)
            snippet = (
                ("…" if start else "")
                + entry.content[start : start + 240]
                + ("…" if start + 240 < len(entry.content) else "")
            )
            results.append(
                {
                    "source_id": source.id,
                    "source_name": source.name,
                    "source_kind": source.kind,
                    "kind": entry.kind,
                    "table_key": entry.table_key,
                    "table_name": entry.table_name,
                    "column_name": entry.column_name,
                    "title": entry.title,
                    "snippet": snippet,
                }
            )
        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "results": results,
        }
