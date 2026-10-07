"""Shared classification styles and permission-checked, atomic tag assignments."""

import hashlib
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func, update, delete

from .i18n import tr
from .jobs import scan_lock
from .models import CatalogTag, Session, SourceMetadata, User
from .security import current, require_admin, access, audit

router = APIRouter(prefix="/api/catalog/tags")


def tag_key(name):
    return hashlib.sha256(name.strip().casefold().encode()).hexdigest()


def normalize_tags(values):
    tags, seen = [], set()
    for value in values:
        name = value.strip()
        if not name or len(name) > 60 or "," in name or any(ord(c) < 32 for c in name):
            raise HTTPException(
                422,
                tr(
                    "Tags müssen 1–60 Zeichen lang sein und dürfen keine Kommas oder Steuerzeichen enthalten."
                ),
            )
        key = tag_key(name)
        if key not in seen:
            tags.append(name)
            seen.add(key)
    if len(tags) > 20:
        raise HTTPException(422, tr("Eine Datenquelle darf höchstens 20 Tags haben."))
    return tags


def definitions(db):
    return {tag.key: tag for tag in db.scalars(select(CatalogTag))}


def styles_for(db, tags, known=None):
    known = definitions(db) if known is None else known
    return {
        name: {"color": tag.color, "category": tag.category}
        for name in tags
        if (tag := known.get(tag_key(name)))
    }


def tag_json(tag):
    return {
        "key": tag.key,
        "name": tag.name,
        "color": tag.color,
        "category": tag.category,
        "version": tag.version,
    }


class TagInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: Literal["blue", "green", "orange", "red", "purple", "teal", "gray"] = "blue"
    category: Literal["location", "function", "environment", "other"] = "other"
    version: int = Field(default=0, ge=0)


class AssignmentInput(BaseModel):
    source_ids: list[int] = Field(min_length=1, max_length=200)
    tags: list[str] = Field(min_length=1, max_length=20)
    mode: Literal["add", "remove"] = "add"


@router.get("")
def list_tags(user: User = Depends(current)):
    # These definitions are explicitly shared by administrators, not harvested
    # from private source records.
    with Session() as db:
        return [
            tag_json(tag)
            for tag in sorted(definitions(db).values(), key=lambda t: t.name.casefold())
        ]


@router.put("")
def save_tag(body: TagInput, user: User = Depends(current)):
    require_admin(user)
    name = normalize_tags([body.name])[0]
    key = tag_key(name)
    with scan_lock, Session() as db:
        existing = db.get(CatalogTag, key)
        if existing:
            result = db.execute(
                update(CatalogTag)
                .where(CatalogTag.key == key, CatalogTag.version == body.version)
                .values(
                    color=body.color, category=body.category, version=body.version + 1
                )
            )
            if result.rowcount != 1:
                raise HTTPException(
                    409, tr("Die Tag-Definition wurde geändert. Bitte neu laden.")
                )
        else:
            if body.version != 0:
                raise HTTPException(
                    409, tr("Die Tag-Definition wurde geändert. Bitte neu laden.")
                )
            if db.scalar(select(func.count()).select_from(CatalogTag)) >= 1000:
                raise HTTPException(
                    422,
                    tr("Es sind höchstens 1.000 gemeinsame Tag-Definitionen möglich."),
                )
            db.add(
                CatalogTag(key=key, name=name, color=body.color, category=body.category)
            )
        audit(db, user, "tag_style_saved", key)
        db.commit()
        return tag_json(db.get(CatalogTag, key))


@router.delete("/{key}")
def remove_style(key: str, version: int, user: User = Depends(current)):
    require_admin(user)
    with scan_lock, Session() as db:
        result = db.execute(
            delete(CatalogTag).where(
                CatalogTag.key == key, CatalogTag.version == version
            )
        )
        if result.rowcount != 1:
            raise HTTPException(
                409, tr("Die Tag-Definition wurde geändert. Bitte neu laden.")
            )
        audit(db, user, "tag_style_deleted", key)
        db.commit()
        return {"removed": True}


@router.post("/assign")
def assign_tags(body: AssignmentInput, user: User = Depends(current)):
    tags = normalize_tags(body.tags)
    ids = list(dict.fromkeys(body.source_ids))
    keys = {tag_key(name) for name in tags}
    with scan_lock, Session() as db:
        # Validate every grant before changing any source, including removals.
        for source_id in ids:
            access(db, user, source_id, edit=True)
        for source_id in ids:
            record = db.get(SourceMetadata, source_id)
            current_tags = record.tags if record else []
            updated = (
                normalize_tags(current_tags + tags)
                if body.mode == "add"
                else [name for name in current_tags if tag_key(name) not in keys]
            )
            if record is None:
                record = SourceMetadata(source_id=source_id)
                db.add(record)
            record.tags = updated
            audit(db, user, "source_metadata_updated", source_id)
        db.commit()
        return {"updated": len(ids)}
