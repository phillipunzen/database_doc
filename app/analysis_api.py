"""Permission-aware source analysis, explicit profiles and DWH preparation."""

import threading
from typing import Literal
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict, model_validator
from sqlalchemy import select, delete
from .models import Session, Source, User, Grant, SourceAnalysis, SourceProfile, now
from .security import access, current, audit, decrypt
from .jobs import scan_lock
from .source_analysis import latest, report, settings
from .data_profiles import read_rows, summarize, evaluate_rules
from .i18n import tr

router = APIRouter(prefix="/api/sources/{source_id}/analysis")
profile_slots = threading.BoundedSemaphore(2)


def data_allowed(db, user, source_id):
    if user.role == "admin":
        return True
    grant = db.scalar(
        select(Grant).where(Grant.source_id == source_id, Grant.user_id == user.id)
    )
    return bool(grant and grant.data)


def scanned_table(db, source_id, key):
    snap = latest(db, source_id)
    t = (
        next((t for t in snap.payload["tables"] if t["key"] == key), None)
        if snap
        else None
    )
    if not t:
        raise HTTPException(404, tr("Objekt nicht im aktuellen Schema gefunden."))
    return snap, t


class Preparation(BaseModel):
    role: Literal["unknown", "fact", "dimension", "reference", "staging"] = "unknown"
    grain: str = Field(default="", max_length=2000)
    load_mode: Literal["undecided", "full", "incremental"] = "undecided"
    change_column: str = Field(default="", max_length=512)
    delete_strategy: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=4000)


class PreparationInput(Preparation):
    version: int = Field(ge=1)
    table_key: str = Field(max_length=700)


class Rule(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    id: str = Field(default_factory=lambda: str(uuid4()), max_length=64)
    table_key: str = Field(max_length=700)
    column: str = Field(max_length=512)
    name: str = Field(min_length=1, max_length=190)
    kind: Literal["not_null", "not_empty", "unique", "range", "freshness"]
    minimum: float | None = None
    maximum: float | None = None
    max_age_hours: float | None = Field(default=None, gt=0, le=876000)

    @model_validator(mode="after")
    def thresholds(self):
        if self.kind == "range" and (
            self.minimum is None
            and self.maximum is None
            or self.minimum is not None
            and self.maximum is not None
            and self.minimum > self.maximum
        ):
            raise ValueError(
                tr("Für den Wertebereich gültige Unter- oder Obergrenzen angeben.")
            )
        if self.kind == "freshness" and self.max_age_hours is None:
            raise ValueError(
                tr("Für die Aktualitätsregel das maximale Alter in Stunden angeben.")
            )
        return self


class RulesInput(BaseModel):
    version: int = Field(ge=1)
    rules: list[Rule] = Field(max_length=200)


class ProfileInput(BaseModel):
    snapshot_id: int
    settings_version: int = Field(ge=1)
    table_key: str = Field(max_length=700)
    columns: list[str] = Field(min_length=1, max_length=20)
    sample_limit: int = Field(default=500, ge=100, le=5000)


def editable_settings(db, user, source_id, version):
    access(db, user, source_id, edit=True)
    row = db.get(SourceAnalysis, source_id)
    if version != (row.version if row else 1):
        raise HTTPException(
            409, tr("Analyse-Einstellungen wurden geändert. Bitte neu laden.")
        )
    if not row:
        row = SourceAnalysis(source_id=source_id, content={"tables": {}, "rules": []})
        db.add(row)
        db.flush()
    return row


@router.get("")
def get_analysis(source_id: int, user: User = Depends(current)):
    with Session() as db:
        source = access(db, user, source_id)
        result = report(db, source)
        result["can_data"] = data_allowed(db, user, source_id)
        return result


@router.put("/preparation")
def save_preparation(
    source_id: int, body: PreparationInput, user: User = Depends(current)
):
    with scan_lock, Session() as db:
        row = editable_settings(db, user, source_id, body.version)
        _, t = scanned_table(db, source_id, body.table_key)
        if body.change_column and body.change_column not in {
            c["name"] for c in t["columns"]
        }:
            raise HTTPException(
                422, tr("Änderungsspalte nicht im aktuellen Scan gefunden.")
            )
        content = {
            **row.content,
            "tables": {
                **row.content.get("tables", {}),
                body.table_key: Preparation(**body.model_dump()).model_dump(),
            },
        }
        row.content, row.version, row.updated = content, row.version + 1, now()
        audit(db, user, "analysis_preparation_saved", source_id)
        db.commit()
        return settings(db, source_id)


@router.put("/rules")
def save_rules(source_id: int, body: RulesInput, user: User = Depends(current)):
    with scan_lock, Session() as db:
        row = editable_settings(db, user, source_id, body.version)
        if len({r.id for r in body.rules}) != len(body.rules):
            raise HTTPException(422, tr("Regel-IDs müssen eindeutig sein."))
        old = {r["id"]: r for r in row.content.get("rules", [])}
        for rule in body.rules:
            # Retain unchanged orphaned rules so they can still be removed after DDL changes.
            if old.get(rule.id) == rule.model_dump():
                continue
            _, t = scanned_table(db, source_id, rule.table_key)
            if rule.column not in {c["name"] for c in t["columns"]}:
                raise HTTPException(
                    422, tr("Regelspalte nicht im aktuellen Scan gefunden.")
                )
        row.content = {**row.content, "rules": [r.model_dump() for r in body.rules]}
        row.version, row.updated = row.version + 1, now()
        audit(db, user, "analysis_rules_saved", source_id)
        db.commit()
        return settings(db, source_id)


@router.get("/profiles")
def profiles(
    source_id: int,
    table_key: str | None = Query(default=None, max_length=700),
    user: User = Depends(current),
):
    with Session() as db:
        access(db, user, source_id, data=True)
        snap = latest(db, source_id)
        config = settings(db, source_id)
        query = select(SourceProfile).where(SourceProfile.source_id == source_id)
        if table_key is not None:
            query = query.where(SourceProfile.table_key == table_key)
        rows = db.scalars(query.order_by(SourceProfile.id.desc()).limit(20))
        return [
            {
                "id": r.id,
                "table_key": r.table_key,
                "snapshot_id": r.snapshot_id,
                "created": r.created,
                "stale_schema": not snap or r.snapshot_id != snap.id,
                "stale_rules": r.content["settings_version"] != config["version"],
                "profile": r.content,
            }
            for r in rows
        ]


@router.post("/profiles")
def create_profile(source_id: int, body: ProfileInput, user: User = Depends(current)):
    if not profile_slots.acquire(blocking=False):
        raise HTTPException(
            429, tr("Zwei Datenprofile laufen bereits. Bitte später versuchen.")
        )
    try:
        with Session() as db:
            source = access(db, user, source_id, data=True)
            snap, table = scanned_table(db, source_id, body.table_key)
            config = settings(db, source_id)
            if (
                snap.id != body.snapshot_id
                or config["version"] != body.settings_version
            ):
                raise HTTPException(
                    409,
                    tr(
                        "Scan oder Analyse-Einstellungen wurden geändert. Bitte neu laden."
                    ),
                )
            if len(set(body.columns)) != len(body.columns) or not set(body.columns) <= {
                c["name"] for c in table["columns"]
            }:
                raise HTTPException(
                    422,
                    tr(
                        "Nur unterschiedliche Spalten aus dem aktuellen Scan auswählen."
                    ),
                )
            source_config, kind, encrypted = (
                decrypt(source),
                source.kind,
                source.config_encrypted,
            )
        try:
            rows = read_rows(
                kind, source_config, table, body.columns, body.sample_limit
            )
            at = now()
            result = summarize(rows, table, body.columns, body.sample_limit, at)
            result["rules"] = evaluate_rules(
                result, config["rules"], body.table_key, at
            )
            result["settings_version"] = config["version"]
        except Exception as error:
            raise HTTPException(
                400,
                tr(
                    "Datenprofil fehlgeschlagen ({0}). Leserechte und aktuellen Struktur-Scan prüfen.",
                    type(error).__name__,
                ),
            )
        with scan_lock, Session() as db:
            fresh_user = db.get(User, user.id)
            if not fresh_user or not fresh_user.active:
                raise HTTPException(403, tr("Konto deaktiviert."))
            source = access(db, fresh_user, source_id, data=True)
            snap = latest(db, source_id)
            if (
                not snap
                or snap.id != body.snapshot_id
                or source.config_encrypted != encrypted
                or source.kind != kind
                or settings(db, source_id)["version"] != body.settings_version
            ):
                raise HTTPException(
                    409,
                    tr(
                        "Scan oder Analyse-Einstellungen wurden geändert. Bitte neu laden."
                    ),
                )
            row = SourceProfile(
                source_id=source_id,
                table_key=body.table_key,
                snapshot_id=snap.id,
                content=result,
                created=at,
            )
            db.add(row)
            db.flush()
            retained = list(
                db.scalars(
                    select(SourceProfile.id)
                    .where(
                        SourceProfile.source_id == source_id,
                        SourceProfile.table_key == body.table_key,
                    )
                    .order_by(SourceProfile.id.desc())
                    .offset(20)
                )
            )
            if retained:
                db.execute(delete(SourceProfile).where(SourceProfile.id.in_(retained)))
            audit(db, fresh_user, "analysis_profile_created", source_id)
            db.commit()
        return {
            "id": row.id,
            "table_key": row.table_key,
            "snapshot_id": row.snapshot_id,
            "created": row.created,
            "stale_schema": False,
            "stale_rules": False,
            "profile": result,
        }
    finally:
        profile_slots.release()
