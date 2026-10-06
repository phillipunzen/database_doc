import hashlib
import json
import os
import secrets
import ssl
from datetime import timedelta
from cryptography.fernet import Fernet
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from fastapi import HTTPException, Request
from sqlalchemy import select, delete
from .i18n import tr
from .models import Session, User, LoginSession, Grant, Source, Audit, now

hasher = PasswordHasher()
fernet = Fernet(os.environ["ENCRYPTION_KEY"].encode())


def encrypt(config):
    return fernet.encrypt(json.dumps(config).encode()).decode()


def decrypt(source):
    return json.loads(fernet.decrypt(source.config_encrypted.encode()))


def audit(db, user, action, target=""):
    db.add(
        Audit(
            user=user.username if hasattr(user, "username") else str(user),
            action=action,
            target=str(target),
        )
    )


def user_json(user):
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "active": user.active,
        "provider": (
            "entra"
            if (user.identity or "").startswith("entra:")
            else "ad" if user.identity else "local"
        ),
    }


def issue_session(db, user, response):
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_hex(32)
    db.execute(delete(LoginSession).where(LoginSession.expires < now()))
    db.add(
        LoginSession(
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            user_id=user.id,
            csrf=csrf,
            expires=now() + timedelta(hours=8),
        )
    )
    audit(db, user, "login")
    db.commit()
    response.set_cookie(
        "datatlas_session",
        token,
        httponly=True,
        secure=os.getenv("COOKIE_SECURE", "true") == "true",
        samesite="lax",
        max_age=28800,
        path="/",
    )
    return csrf


def current(request: Request):
    token = request.cookies.get("datatlas_session", "")
    with Session() as db:
        session = db.get(LoginSession, hashlib.sha256(token.encode()).hexdigest())
        if not session or session.expires < now():
            raise HTTPException(401, tr("Bitte anmelden."))
        user = db.get(User, session.user_id)
        if not user or not user.active:
            raise HTTPException(401, tr("Konto ist deaktiviert."))
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            if not secrets.compare_digest(
                request.headers.get("x-csrf-token", ""), session.csrf
            ):
                raise HTTPException(403, tr("Ungültiger CSRF-Token."))
        return user


def require_admin(user):
    if user.role != "admin":
        raise HTTPException(
            403, tr("Nur Administratoren dürfen diese Aktion ausführen.")
        )


def access(db, user, source_id, edit=False, data=False):
    source = db.get(Source, source_id)
    if not source:
        raise HTTPException(404, tr("Datenquelle nicht gefunden."))
    if user.role == "admin":
        return source
    grant = db.scalar(
        select(Grant).where(Grant.source_id == source_id, Grant.user_id == user.id)
    )
    if (
        not grant
        or (edit and (user.role != "editor" or not grant.edit))
        or (data and not grant.data)
    ):
        raise HTTPException(403, tr("Keine Berechtigung für diese Datenquelle."))
    return source


def ad_auth(username, password):
    from ldap3 import Server, Connection, Tls, AUTO_BIND_NO_TLS
    from ldap3.utils.conv import escape_filter_chars

    if not password or not username or len(username) > 150:
        return None
    tls = Tls(
        validate=ssl.CERT_REQUIRED, ca_certs_file=os.getenv("LDAP_CA_FILE") or None
    )
    server = Server(
        os.environ["LDAP_HOST"],
        port=int(os.getenv("LDAP_PORT", "636")),
        use_ssl=True,
        tls=tls,
        connect_timeout=10,
    )
    with Connection(
        server,
        user=os.environ["LDAP_BIND_DN"],
        password=os.environ["LDAP_BIND_PASSWORD"],
        auto_bind=AUTO_BIND_NO_TLS,
        receive_timeout=10,
    ) as service:
        service.search(
            os.environ["LDAP_BASE_DN"],
            f"(&(objectClass=user)(sAMAccountName={escape_filter_chars(username)}))",
            attributes=["displayName", "objectGUID"],
            size_limit=2,
        )
        if len(service.entries) != 1:
            return None
        entry = service.entries[0]
        dn = entry.entry_dn
        display = str(entry.displayName) or username
        guid = str(entry.objectGUID)
    with Connection(
        server,
        user=dn,
        password=password,
        auto_bind=AUTO_BIND_NO_TLS,
        receive_timeout=10,
    ) as bound:
        if bound.bound:
            return {
                "identity": "ad:" + guid,
                "username": "ad:" + username.lower(),
                "display_name": display,
            }
    return None
