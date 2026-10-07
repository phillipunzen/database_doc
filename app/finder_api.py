"""Permission-aware data discovery; values are neither stored nor sent externally."""

import threading
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from .models import Session, User
from pathlib import Path
from .security import current, access, decrypt, audit
from .analysis_api import scanned_table
from .source_analysis import latest
from .data_finder import candidates, text_field
from .value_finder import search_targets
from .jobs import scan_lock
from .i18n import tr

router = APIRouter(prefix="/api/finder")
slots = threading.BoundedSemaphore(2)


class CandidateInput(BaseModel):
    query: str = Field(default="", max_length=200)
    value_hint: str = Field(default="", max_length=200)
    source_ids: list[int] = Field(default_factory=list, max_length=1000)
    page: int = Field(default=1, ge=1, le=100000)
    page_size: int = Field(default=25, ge=1, le=50)

    @model_validator(mode="after")
    def valid(self):
        if len(self.query.strip()) < 2 and len(self.value_hint.strip()) < 2:
            raise ValueError(
                tr(
                    "Bitte einen Suchbegriff oder Beispielwert mit mindestens zwei Zeichen angeben."
                )
            )
        return self


class TargetInput(BaseModel):
    source_id: int
    snapshot_id: int
    table_key: str = Field(max_length=700)
    columns: list[str] = Field(min_length=1, max_length=10)


class ValueInput(BaseModel):
    value: str = Field(min_length=1, max_length=200)
    mode: Literal["exact", "contains"] = "exact"
    targets: list[TargetInput] = Field(min_length=1, max_length=5)

    @model_validator(mode="after")
    def valid(self):
        if not self.value.strip():
            raise ValueError(tr("Bitte einen Beispielwert angeben."))
        if sum(len(t.columns) for t in self.targets) > 10:
            raise ValueError(
                tr("Pro Suche sind maximal zehn Spalten in fünf Objekten möglich.")
            )
        if len({(t.source_id, t.table_key) for t in self.targets}) != len(self.targets):
            raise ValueError(tr("Objekte dürfen nur einmal ausgewählt werden."))
        return self


@router.post("/candidates")
def suggest(body: CandidateInput, user: User = Depends(current)):
    with Session() as db:
        return candidates(
            db,
            user,
            body.query,
            body.value_hint,
            body.source_ids,
            body.page,
            body.page_size,
        )


@router.post("/values")
def find_values(body: ValueInput, user: User = Depends(current)):
    if not slots.acquire(blocking=False):
        raise HTTPException(
            429, tr("Zwei Beispielwert-Suchen laufen bereits. Bitte später versuchen.")
        )
    try:
        targets = []
        with Session() as db:
            for t in body.targets:
                source = access(db, user, t.source_id, data=True)
                snap, table = scanned_table(db, t.source_id, t.table_key)
                if snap.id != t.snapshot_id:
                    raise HTTPException(
                        409,
                        tr(
                            "Der Struktur-Scan wurde geändert. Bitte Vorschläge neu laden."
                        ),
                    )
                allowed = {
                    c["name"] for c in table["columns"] if text_field(c, source.kind)
                }
                if (
                    len(set(t.columns)) != len(t.columns)
                    or not set(t.columns) <= allowed
                ):
                    raise HTTPException(422, tr("Nur gescannte Textspalten auswählen."))
                cfg = decrypt(source)
                targets.append(
                    {
                        "source_id": source.id,
                        "source_name": source.name,
                        "snapshot_id": snap.id,
                        "kind": source.kind,
                        "encrypted": source.config_encrypted,
                        "cfg": cfg,
                        "database_name": cfg.get("database")
                        or Path(cfg.get("path", "")).name,
                        "table": table,
                        "columns": t.columns,
                    }
                )

        def check_access():
            with Session() as db:
                fresh = db.get(User, user.id)
                if not fresh or not fresh.active:
                    raise HTTPException(403, tr("Konto deaktiviert."))
                for t in targets:
                    source = access(db, fresh, t["source_id"], data=True)
                    snap = latest(db, source.id)
                    if (
                        not snap
                        or snap.id != t["snapshot_id"]
                        or source.kind != t["kind"]
                        or source.config_encrypted != t["encrypted"]
                    ):
                        raise HTTPException(
                            409,
                            tr(
                                "Scan oder Verbindung wurden geändert. Bitte Vorschläge neu laden."
                            ),
                        )

        results = search_targets(targets, body.value, body.mode, check_access)
        with scan_lock:
            check_access()
            with Session() as db:
                audit(
                    db,
                    user,
                    "finder_value_search",
                    ",".join(str(i) for i in sorted({t["source_id"] for t in targets})),
                )
                db.commit()
        return {
            "results": results,
            "mode": body.mode,
            "checked_columns": sum(
                c["status"] in {"found", "not_found"}
                for r in results
                for c in r["columns"]
            ),
            "found_columns": sum(
                c["status"] == "found" for r in results for c in r["columns"]
            ),
            "incomplete": any(
                c["status"] in {"error", "not_checked"}
                for r in results
                for c in r["columns"]
            ),
        }
    finally:
        slots.release()
