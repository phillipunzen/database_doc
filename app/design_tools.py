"""Private database designs and explicit grants; compile DDL without connecting to a database."""

import json
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import Field, model_validator
from sqlalchemy import select, delete, update, or_

from .i18n import tr
from .jobs import scan_lock
from .models import Session, User, DatabaseDesign, DatabaseDesignGrant, now
from .security import current, audit
from .warehouse import (
    Input,
    EngineKind,
    ProjectInput,
    RelationPlan,
    ColumnPlan,
    identifier,
    dialect,
    sql_script,
)

router = APIRouter(prefix="/api/tools/designs")


class DesignColumn(Input):
    id: UUID = Field(default_factory=uuid4)
    name: str = Field(min_length=1, max_length=63)
    data_type: Literal[
        "int",
        "bigint",
        "decimal",
        "varchar",
        "text",
        "date",
        "datetime",
        "boolean",
        "uuid",
        "binary",
    ] = "varchar"
    length: int = Field(default=255, ge=1, le=4000)
    precision: int = Field(default=18, ge=1, le=38)
    scale: int = Field(default=2, ge=0, le=38)
    nullable: bool = True
    primary_key: bool = False
    identity: bool = False
    description: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def valid(self):
        ColumnPlan.model_validate(self.model_dump())
        return self


class DesignTable(Input):
    id: UUID = Field(default_factory=uuid4)
    name: str = Field(min_length=1, max_length=63)
    description: str = Field(default="", max_length=4000)
    columns: list[DesignColumn] = Field(default_factory=list, max_length=200)
    relations: list[RelationPlan] = Field(default_factory=list, max_length=30)


class DesignInput(Input):
    name: str = Field(min_length=1, max_length=190)
    description: str = Field(default="", max_length=10000)
    target_kind: EngineKind
    database_name: str = Field(min_length=1, max_length=63)
    target_schema: str = Field(default="public", min_length=1, max_length=63)
    tables: list[DesignTable] = Field(default_factory=list, max_length=300)
    version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def valid(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError(tr("Bitte einen Entwurfsnamen angeben."))
        identifier(self.database_name)
        identifier(self.target_schema)
        if self.target_kind == "mariadb":
            self.target_schema = self.database_name
        as_project(self)
        return self


def as_project(body):
    return ProjectInput(
        name=body.name,
        goal=body.description,
        target_kind=body.target_kind,
        target_schema=body.target_schema,
        tables=body.model_dump(mode="json")["tables"],
    )


def design_access(db, user, design_id, edit=False, owner=False):
    design = db.get(DatabaseDesign, design_id)
    if design and design.owner_id == user.id:
        return design
    grant = (
        db.get(DatabaseDesignGrant, (design_id, user.id))
        if design and not owner
        else None
    )
    if not grant or (edit and not grant.edit):
        raise HTTPException(
            404, tr("Entwurf nicht verfügbar oder keine ausreichende Freigabe.")
        )
    return design


def design_json(db, user, design, detail=True):
    owner = db.get(User, design.owner_id)
    grant = db.get(DatabaseDesignGrant, (design.id, user.id))
    result = {
        "id": design.id,
        "owner_id": design.owner_id,
        "owner_name": owner.display_name if owner else "",
        "version": design.version,
        "created": design.created,
        "updated": design.updated,
        "is_owner": design.owner_id == user.id,
        "can_edit": design.owner_id == user.id or bool(grant and grant.edit),
        "shared": bool(
            db.scalar(
                select(DatabaseDesignGrant.user_id)
                .where(DatabaseDesignGrant.design_id == design.id)
                .limit(1)
            )
        ),
        "table_count": len(design.content.get("tables", [])),
        **{k: v for k, v in design.content.items() if detail or k != "tables"},
    }
    if detail and design.owner_id == user.id:
        result["grants"] = [
            {
                "user_id": g.user_id,
                "edit": g.edit,
                "display_name": u.display_name,
                "username": u.username,
                "active": u.active,
            }
            for g, u in db.execute(
                select(DatabaseDesignGrant, User)
                .join(User, User.id == DatabaseDesignGrant.user_id)
                .where(DatabaseDesignGrant.design_id == design.id)
                .order_by(User.display_name, User.id)
            )
        ]
    return result


def bump(db, design, version, **values):
    result = db.execute(
        update(DatabaseDesign)
        .where(DatabaseDesign.id == design.id, DatabaseDesign.version == version)
        .values(**values, version=DatabaseDesign.version + 1, updated=now())
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise HTTPException(
            409,
            tr(
                "Der Entwurf wurde inzwischen geändert. Bitte neu laden und die Änderungen zusammenführen."
            ),
        )
    db.expire(design)


@router.get("")
def list_designs(user: User = Depends(current)):
    with Session() as db:
        query = (
            select(DatabaseDesign)
            .where(
                or_(
                    DatabaseDesign.owner_id == user.id,
                    DatabaseDesign.id.in_(
                        select(DatabaseDesignGrant.design_id).where(
                            DatabaseDesignGrant.user_id == user.id
                        )
                    ),
                )
            )
            .order_by(DatabaseDesign.updated.desc())
        )
        return [design_json(db, user, d, detail=False) for d in db.scalars(query)]


@router.post("")
def create_design(body: DesignInput, user: User = Depends(current)):
    with scan_lock, Session() as db:
        design = DatabaseDesign(
            owner_id=user.id, content=body.model_dump(mode="json", exclude={"version"})
        )
        db.add(design)
        db.flush()
        audit(db, user, "database_design_created", design.id)
        db.commit()
        return design_json(db, user, design)


@router.get("/{design_id}")
def get_design(design_id: int, user: User = Depends(current)):
    with Session() as db:
        return design_json(db, user, design_access(db, user, design_id))


@router.put("/{design_id}")
def save_design(design_id: int, body: DesignInput, user: User = Depends(current)):
    with scan_lock, Session() as db:
        design = design_access(db, user, design_id, edit=True)
        if body.version is None:
            raise HTTPException(422, tr("Entwurfsversion fehlt. Bitte neu laden."))
        bump(
            db,
            design,
            body.version,
            content=body.model_dump(mode="json", exclude={"version"}),
        )
        audit(db, user, "database_design_saved", design.id)
        db.commit()
        return design_json(db, user, design)


@router.delete("/{design_id}")
def remove_design(design_id: int, version: int, user: User = Depends(current)):
    with scan_lock, Session() as db:
        design = design_access(db, user, design_id, owner=True)
        bump(db, design, version)
        db.execute(
            delete(DatabaseDesignGrant).where(
                DatabaseDesignGrant.design_id == design.id
            )
        )
        db.delete(design)
        audit(db, user, "database_design_deleted", design_id)
        db.commit()
        return {"ok": True}


class SharingGrant(Input):
    user_id: int = Field(gt=0)
    edit: bool = False


class SharingInput(Input):
    version: int = Field(ge=1)
    grants: list[SharingGrant] = Field(default_factory=list, max_length=200)


@router.get("/{design_id}/users")
def share_users(design_id: int, q: str = "", user: User = Depends(current)):
    with Session() as db:
        design_access(db, user, design_id, owner=True)
        q = q.strip()
        if len(q) > 190:
            raise HTTPException(422, tr("Suchbegriff zu lang."))
        query = select(User).where(User.active.is_(True), User.id != user.id)
        if q:
            query = query.where(
                or_(
                    User.display_name.contains(q, autoescape=True),
                    User.username.contains(q, autoescape=True),
                )
            )
        return [
            {"id": u.id, "display_name": u.display_name, "username": u.username}
            for u in db.scalars(query.order_by(User.display_name, User.id).limit(100))
        ]


@router.put("/{design_id}/sharing")
def share_design(design_id: int, body: SharingInput, user: User = Depends(current)):
    with scan_lock, Session() as db:
        design = design_access(db, user, design_id, owner=True)
        ids = [g.user_id for g in body.grants]
        if len(set(ids)) != len(ids) or user.id in ids:
            raise HTTPException(
                422, tr("Freigaben benötigen eindeutige Benutzer ohne den Eigentümer.")
            )
        valid = set(
            db.scalars(select(User.id).where(User.id.in_(ids), User.active.is_(True)))
        )
        if set(ids) != valid:
            raise HTTPException(
                422, tr("Bitte aktive Benutzer für die Freigabe auswählen.")
            )
        bump(db, design, body.version)
        db.execute(
            delete(DatabaseDesignGrant).where(
                DatabaseDesignGrant.design_id == design.id
            )
        )
        db.add_all(
            [
                DatabaseDesignGrant(design_id=design.id, user_id=g.user_id, edit=g.edit)
                for g in body.grants
            ]
        )
        audit(db, user, "database_design_sharing_changed", design.id)
        db.commit()
        return design_json(db, user, design)


def design_sql(body, mode):
    d = dialect(body.target_kind)
    name = d.identifier_preparer.quote_identifier(body.database_name)
    header = "-- DatabaseDoc database design\n-- Review and run manually on the intended server.\n"
    if mode == "database":
        extra = " CHARACTER SET utf8mb4" if body.target_kind == "mariadb" else ""
        return (
            header
            + "-- Run separately, outside a transaction.\n"
            + f"CREATE DATABASE {name}{extra};\n"
        )
    if mode == "drop":
        return (
            header
            + "-- DESTRUCTIVE: deletes the entire database and all of its data.\n-- Run separately, outside a transaction, connected to a different database.\n"
            + f"DROP DATABASE {name};\n"
        )
    if mode != "schema":
        raise HTTPException(422, tr("Unbekannter SQL-Export."))
    script = sql_script(as_project(body))
    script = script.replace(
        "-- DatabaseDoc warehouse blueprint", "-- DatabaseDoc database design"
    ).replace("-- Mappings and transformation notes are documentation; this script does not load data.\n", "")
    if body.target_kind in {"mssql", "mariadb"}:
        script = f"USE {name};\n\n" + script
    return (
        header
        + f"-- Connect to database {name} before running this table/relationship script.\n"
        + script
    )


@router.get("/{design_id}/export")
def export_design(
    design_id: int,
    format: Literal["sql", "json"] = "sql",
    mode: str = "schema",
    user: User = Depends(current),
):
    with Session() as db:
        design = design_access(db, user, design_id)
        body = DesignInput.model_validate({**design.content, "version": design.version})
        try:
            content = (
                design_sql(body, mode)
                if format == "sql"
                else json.dumps(
                    design_json(db, user, design),
                    ensure_ascii=False,
                    indent=2,
                    default=str,
                )
            )
        except ValueError as error:
            raise HTTPException(422, str(error))
        return Response(
            content,
            media_type="application/sql" if format == "sql" else "application/json",
            headers={
                "Content-Disposition": f'attachment; filename="databasedoc-design-{design.id}-{mode if format == "sql" else "plan"}.{format}"',
                "Cache-Control": "no-store",
            },
        )
