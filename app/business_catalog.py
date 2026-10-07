"""Confirmed business mappings and metadata suggestions across authorized sources."""

import re
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from .models import Session, Source, Grant, BusinessConcept, now
from .security import access, current, audit
from .source_analysis import latest, family
from .analysis_api import scanned_table
from .jobs import scan_lock
from .i18n import tr

router = APIRouter(prefix="/api/analysis")


def visible_sources(db, user):
    query = select(Source)
    if user.role != "admin":
        query = query.join(Grant, Grant.source_id == Source.id).where(
            Grant.user_id == user.id
        )
    return list(db.scalars(query.order_by(Source.name, Source.id)))


def can_edit(db, user, ids):
    if user.role == "admin":
        return True
    if user.role != "editor":
        return False
    grants = set(
        db.scalars(
            select(Grant.source_id).where(
                Grant.user_id == user.id, Grant.edit.is_(True)
            )
        )
    )
    return set(ids) <= grants


def source_ids(content):
    return {b["source_id"] for b in content.get("bindings", [])}


def uses_source(db, source_id):
    return any(
        source_id in source_ids(r.content) for r in db.scalars(select(BusinessConcept))
    )


def concept_json(db, user, row):
    bindings = []
    for b in row.content["bindings"]:
        source = db.get(Source, b["source_id"])
        snap = latest(db, b["source_id"])
        t = (
            next(
                (t for t in snap.payload["tables"] if t["key"] == b["table_key"]), None
            )
            if snap
            else None
        )
        col = (
            next((c for c in t["columns"] if c["name"] == b["column"]), None)
            if t
            else None
        )
        state = (
            "missing"
            if not col
            else "changed" if col.get("type") != b["data_type"] else "current"
        )
        bindings.append(
            {
                **b,
                "source_name": source.name if source else "",
                "table_name": t["name"] if t else b.get("table_name", ""),
                "state": state,
                "new_scan": bool(snap and snap.id != b["snapshot_id"]),
                "current_type": col.get("type", "") if col else None,
            }
        )
    return {
        "id": row.id,
        "version": row.version,
        "updated": row.updated,
        **row.content,
        "bindings": bindings,
        "can_edit": can_edit(db, user, source_ids(row.content)),
    }


def norm(value):
    return re.sub(
        r"[^a-z0-9]",
        "",
        value.casefold().replace("ü", "ue").replace("ä", "ae").replace("ö", "oe"),
    )


ENTITIES = {
    "customer": {
        "customer",
        "customers",
        "kunde",
        "kunden",
        "client",
        "clients",
        "account",
        "accounts",
    },
    "machine": {"machine", "machines", "maschine", "maschinen"},
    "article": {"article", "articles", "artikel", "product", "products"},
    "order": {"order", "orders", "auftrag", "auftraege", "bestellung", "bestellungen"},
}


@router.get("/catalog")
def global_catalog(user=Depends(current)):
    with Session() as db:
        sources = visible_sources(db, user)
        ids = {s.id for s in sources}
        summaries, groups, capped = [], defaultdict(list), False
        for s in sources:
            snap = latest(db, s.id)
            tables = snap.payload["tables"] if snap else []
            summaries.append(
                {
                    "id": s.id,
                    "name": s.name,
                    "kind": s.kind,
                    "snapshot_id": snap.id if snap else None,
                    "scanned_at": snap.created if snap else None,
                    "objects": len(tables),
                }
            )
            for t in tables:
                entity = next(
                    (
                        key
                        for key, names in ENTITIES.items()
                        if norm(t["name"]) in names
                    ),
                    None,
                )
                for c in t["columns"]:
                    token = norm(c["name"])
                    generic = token in {
                        "id",
                        "name",
                        "status",
                        "value",
                        "type",
                        "date",
                        "createdat",
                        "updatedat",
                    }
                    if not c.get("primary_key") and not re.search(
                        r"id$|number|nummer|code$|key$", token
                    ):
                        continue
                    keys = []
                    if not generic:
                        keys.append(("field", token, family(c.get("type", ""))))
                    if entity and (
                        c.get("primary_key")
                        or token in {"id", "number", "code", "externalnumber"}
                        or re.search(r"id$|nummer|number", token)
                    ):
                        keys.append(("entity", entity, family(c.get("type", ""))))
                    for key in keys:
                        if key not in groups and len(groups) >= 20000:
                            capped = True
                            continue
                        members = groups[key]
                        if len(members) >= 40:
                            capped = True
                            continue
                        members.append(
                            {
                                "source_id": s.id,
                                "source_name": s.name,
                                "snapshot_id": snap.id,
                                "table_key": t["key"],
                                "table_name": t["name"],
                                "schema": t.get("schema", ""),
                                "column": c["name"],
                                "data_type": c.get("type", ""),
                            }
                        )
        candidates = [
            {"kind": k[0], "name": k[1], "type_family": k[2], "bindings": v}
            for k, v in groups.items()
            if len({b["source_id"] for b in v}) >= 2
        ]
        candidates.sort(
            key=lambda g: (
                -len({b["source_id"] for b in g["bindings"]}),
                g["name"],
                g["kind"],
            )
        )
        concepts = [
            concept_json(db, user, r)
            for r in db.scalars(
                select(BusinessConcept).order_by(BusinessConcept.id.desc())
            )
            if source_ids(r.content) <= ids
        ]
        return {
            "sources": summaries,
            "concepts": concepts,
            "suggestions": [
                {
                    **c,
                    "can_confirm": can_edit(
                        db, user, {b["source_id"] for b in c["bindings"]}
                    ),
                }
                for c in candidates[:200]
            ],
            "suggestions_truncated": capped or len(candidates) > 200,
            "can_create": user.role in {"admin", "editor"},
        }


class BindingInput(BaseModel):
    source_id: int
    table_key: str = Field(max_length=700)
    column: str = Field(max_length=512)
    transformation: str = Field(default="", max_length=2000)
    confirm_current: bool = False


class ConceptInput(BaseModel):
    version: int | None = Field(default=None, ge=1)
    name: str = Field(min_length=1, max_length=190)
    definition: str = Field(default="", max_length=4000)
    owner: str = Field(default="", max_length=190)
    leading_binding: int | None = Field(default=None, ge=0)
    bindings: list[BindingInput] = Field(min_length=1, max_length=40)

    @model_validator(mode="after")
    def valid_bindings(self):
        if self.leading_binding is not None and self.leading_binding >= len(
            self.bindings
        ):
            raise ValueError(tr("Führende Zuordnung nicht vorhanden."))
        if len({(b.source_id, b.table_key, b.column) for b in self.bindings}) != len(
            self.bindings
        ):
            raise ValueError(tr("Feldzuordnungen müssen eindeutig sein."))
        return self


def concept_access(db, user, concept_id, edit=False):
    row = db.get(BusinessConcept, concept_id)
    if not row or not source_ids(row.content) <= {
        s.id for s in visible_sources(db, user)
    }:
        raise HTTPException(
            404, tr("Fachbegriff nicht gefunden oder nicht freigegeben.")
        )
    if edit and not can_edit(db, user, source_ids(row.content)):
        raise HTTPException(
            403, tr("Bearbeitungsrechte für alle zugeordneten Quellen erforderlich.")
        )
    return row


def save_concept(db, user, body, row=None):
    if user.role not in {"admin", "editor"}:
        raise HTTPException(
            403, tr("Bearbeitungsrechte für alle zugeordneten Quellen erforderlich.")
        )
    if row and body.version != row.version:
        raise HTTPException(409, tr("Fachbegriff wurde geändert. Bitte neu laden."))
    bindings = []
    old = (
        {
            (b["source_id"], b["table_key"], b["column"]): b
            for b in row.content["bindings"]
        }
        if row
        else {}
    )
    for b in body.bindings:
        access(db, user, b.source_id, edit=True)
        retained = old.get((b.source_id, b.table_key, b.column))
        if retained and not b.confirm_current:
            bindings.append({**retained, "transformation": b.transformation})
            continue
        try:
            snap, t = scanned_table(db, b.source_id, b.table_key)
            col = next((c for c in t["columns"] if c["name"] == b.column), None)
        except HTTPException:
            col = None
        if not col:
            if not retained or b.confirm_current:
                raise HTTPException(
                    422, tr("Zuordnungsfeld nicht im aktuellen Scan gefunden.")
                )
            bindings.append({**retained, "transformation": b.transformation})
        else:
            bindings.append(
                {
                    **b.model_dump(exclude={"confirm_current"}),
                    "snapshot_id": snap.id,
                    "data_type": col.get("type", ""),
                    "table_name": t["name"],
                }
            )
    content = {
        "name": body.name.strip(),
        "definition": body.definition,
        "owner": body.owner,
        "leading_binding": body.leading_binding,
        "bindings": bindings,
    }
    if not content["name"]:
        raise HTTPException(422, tr("Bitte einen Namen angeben."))
    if not row:
        row = BusinessConcept(content=content)
        db.add(row)
        db.flush()
    else:
        row.content, row.version, row.updated = content, row.version + 1, now()
    audit(db, user, "analysis_concept_saved", row.id)
    db.commit()
    return concept_json(db, user, row)


@router.post("/concepts")
def create_concept(body: ConceptInput, user=Depends(current)):
    with scan_lock, Session() as db:
        return save_concept(db, user, body)


@router.put("/concepts/{concept_id}")
def update_concept(concept_id: int, body: ConceptInput, user=Depends(current)):
    with scan_lock, Session() as db:
        return save_concept(
            db, user, body, concept_access(db, user, concept_id, edit=True)
        )


class VersionInput(BaseModel):
    version: int = Field(ge=1)


@router.delete("/concepts/{concept_id}")
def remove_concept(concept_id: int, body: VersionInput, user=Depends(current)):
    with scan_lock, Session() as db:
        row = concept_access(db, user, concept_id, edit=True)
        if row.version != body.version:
            raise HTTPException(409, tr("Fachbegriff wurde geändert. Bitte neu laden."))
        db.delete(row)
        audit(db, user, "analysis_concept_removed", concept_id)
        db.commit()
        return {"ok": True}
