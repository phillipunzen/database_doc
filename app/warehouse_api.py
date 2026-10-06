"""Source-authorized warehouse project planning and read-only target verification."""

import json
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import Field, ValidationError
from sqlalchemy import select, delete, update
from .models import (
    Session,
    Source,
    Snapshot,
    Grant,
    User,
    WarehouseProject,
    WarehouseProjectSource,
    now,
)
from .security import current, access, audit
from .jobs import scan_lock
from .warehouse import (
    Input,
    ProjectInput,
    TablePlan,
    ColumnPlan,
    Mapping,
    inferred_type,
    sql_script,
    planning_issues,
    compare_target,
    ROLES,
    LAYERS,
    STATUSES,
)

router = APIRouter(prefix="/api/dwh/projects")


def latest(db, source_id):
    return db.scalar(
        select(Snapshot)
        .where(Snapshot.source_id == source_id)
        .order_by(Snapshot.id.desc())
        .limit(1)
    )


def bindings(db, project):
    ids = set(
        db.scalars(
            select(WarehouseProjectSource.source_id).where(
                WarehouseProjectSource.project_id == project.id
            )
        )
    )
    if project.target_source_id:
        ids.add(project.target_source_id)
    return ids


def allowed(db, user, project, edit=False):
    if user.role == "admin":
        return True
    if edit and user.role != "editor":
        return False
    ids = bindings(db, project)
    if not ids:
        return project.created_by_id == user.id
    grants = {
        g.source_id: g
        for g in db.scalars(
            select(Grant).where(Grant.user_id == user.id, Grant.source_id.in_(ids))
        )
    }
    return all(i in grants and (not edit or grants[i].edit) for i in ids)


def project_access(db, user, project_id, edit=False):
    project = db.get(WarehouseProject, project_id)
    if not project or not allowed(db, user, project, edit):
        raise HTTPException(
            404, "DWH-Projekt nicht verfügbar oder keine ausreichende Freigabe."
        )
    return project


def source_ids(db, project):
    return list(
        db.scalars(
            select(WarehouseProjectSource.source_id)
            .where(WarehouseProjectSource.project_id == project.id)
            .order_by(WarehouseProjectSource.source_id)
        )
    )


def as_input(db, project):
    return ProjectInput(
        name=project.name,
        goal=project.goal,
        target_kind=project.target_kind,
        target_schema=project.target_schema,
        target_source_id=project.target_source_id,
        source_ids=source_ids(db, project),
        tables=project.blueprint.get("tables", []),
        version=project.version,
    )


def mapping_issues(db, body):
    issues = []
    snapshots = {i: latest(db, i) for i in body.source_ids}
    originals = {}
    for t in body.tables:
        for c in t.columns:
            if not c.mapping:
                continue
            m = c.mapping
            latest_snapshot = snapshots[m.source_id]
            source_table = (
                next(
                    (
                        x
                        for x in latest_snapshot.payload["tables"]
                        if x["key"] == m.table_key
                    ),
                    None,
                )
                if latest_snapshot
                else None
            )
            latest_column = (
                next(
                    (x for x in source_table["columns"] if x["name"] == m.column_name),
                    None,
                )
                if source_table
                else None
            )
            if latest_column is None:
                issues.append(f"{t.name}.{c.name}: Quellfeld fehlt im aktuellen Scan.")
                continue
            if m.snapshot_id not in originals:
                originals[m.snapshot_id] = db.get(Snapshot, m.snapshot_id)
            original = originals[m.snapshot_id]
            old_table = next(
                x for x in original.payload["tables"] if x["key"] == m.table_key
            )
            old_column = next(
                x for x in old_table["columns"] if x["name"] == m.column_name
            )
            if latest_column["type"] != old_column["type"] or latest_column.get(
                "nullable"
            ) != old_column.get("nullable"):
                issues.append(
                    f"{t.name}.{c.name}: Quelltyp oder NULL-Zulässigkeit hat sich seit der Zuordnung geändert."
                )
    return issues


def project_json(db, user, project, detail=True):
    body = as_input(db, project)
    result = {
        "id": project.id,
        "name": project.name,
        "goal": project.goal,
        "target_kind": project.target_kind,
        "target_schema": project.target_schema,
        "target_source_id": project.target_source_id,
        "source_ids": body.source_ids,
        "version": project.version,
        "created": project.created,
        "updated": project.updated,
        "can_edit": allowed(db, user, project, edit=True),
        "table_count": len(body.tables),
        "implemented_count": sum(
            t.status in {"implemented", "accepted"} for t in body.tables
        ),
    }
    if detail:
        result.update(
            tables=body.model_dump(mode="json")["tables"],
            issues=planning_issues(body),
            mapping_issues=mapping_issues(db, body),
        )
    return result


def validate_sources(db, user, body):
    ids = set(body.source_ids)
    if body.target_source_id:
        ids.add(body.target_source_id)
    for source_id in ids:
        source = access(db, user, source_id, edit=True)
        if source_id == body.target_source_id and source.kind != body.target_kind:
            raise HTTPException(
                422,
                "Zielplattform und Zieldatenquelle müssen denselben Datenbanktyp haben.",
            )
    snapshots = {}
    for t in body.tables:
        for c in t.columns:
            if not c.mapping:
                continue
            m = c.mapping
            if m.source_id not in body.source_ids:
                raise HTTPException(
                    422,
                    "Feldzuordnungen dürfen nur ausgewählte Projektquellen verwenden.",
                )
            if m.snapshot_id not in snapshots:
                snapshots[m.snapshot_id] = db.get(Snapshot, m.snapshot_id)
            snap = snapshots[m.snapshot_id]
            if not snap or snap.source_id != m.source_id:
                raise HTTPException(
                    422, "Der Quellscan gehört nicht zur zugeordneten Datenquelle."
                )
            table = next(
                (x for x in snap.payload["tables"] if x["key"] == m.table_key), None
            )
            if not table or not any(
                x["name"] == m.column_name for x in table["columns"]
            ):
                raise HTTPException(422, "Das Quellfeld fehlt im ausgewählten Scan.")


def store_project(db, user, project, body):
    validate_sources(db, user, body)
    values = {
        "name": body.name,
        "goal": body.goal,
        "target_kind": body.target_kind,
        "target_schema": body.target_schema,
        "target_source_id": body.target_source_id,
        "blueprint": {"tables": body.model_dump(mode="json")["tables"]},
        "updated": now(),
    }
    if project.id is not None:
        if body.version is None:
            raise HTTPException(422, "Projektversion fehlt. Bitte Projekt neu laden.")
        result = db.execute(
            update(WarehouseProject)
            .where(
                WarehouseProject.id == project.id,
                WarehouseProject.version == body.version,
            )
            .values(**values, version=WarehouseProject.version + 1)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            raise HTTPException(
                409,
                "Das Projekt wurde inzwischen geändert. Bitte neu laden und die Änderungen zusammenführen.",
            )
        db.expire(project)
    else:
        for key, value in values.items():
            setattr(project, key, value)
        project.created_by_id = user.id
        db.add(project)
        db.flush()
    db.execute(
        delete(WarehouseProjectSource).where(
            WarehouseProjectSource.project_id == project.id
        )
    )
    db.add_all(
        [
            WarehouseProjectSource(project_id=project.id, source_id=i)
            for i in body.source_ids
        ]
    )
    audit(db, user, "dwh_project_saved", project.id)
    db.commit()
    return project_json(db, user, project)


@router.get("")
def list_projects(user: User = Depends(current)):
    with Session() as db:
        return [
            project_json(db, user, p, detail=False)
            for p in db.scalars(
                select(WarehouseProject).order_by(WarehouseProject.updated.desc())
            )
            if allowed(db, user, p)
        ]


@router.post("")
def create_project(body: ProjectInput, user: User = Depends(current)):
    if user.role not in {"admin", "editor"}:
        raise HTTPException(
            403, "Nur Administratoren und Bearbeiter können DWH-Projekte anlegen."
        )
    with scan_lock, Session() as db:
        return store_project(db, user, WarehouseProject(), body)


@router.get("/{project_id}")
def get_project(project_id: int, user: User = Depends(current)):
    with Session() as db:
        return project_json(db, user, project_access(db, user, project_id))


@router.put("/{project_id}")
def save_project(project_id: int, body: ProjectInput, user: User = Depends(current)):
    with scan_lock, Session() as db:
        return store_project(
            db, user, project_access(db, user, project_id, edit=True), body
        )


@router.delete("/{project_id}")
def delete_project(project_id: int, version: int, user: User = Depends(current)):
    with scan_lock, Session() as db:
        p = project_access(db, user, project_id, edit=True)
        if p.version != version:
            raise HTTPException(
                409, "Projekt wurde inzwischen geändert. Bitte neu laden."
            )
        db.execute(
            delete(WarehouseProjectSource).where(
                WarehouseProjectSource.project_id == project_id
            )
        )
        db.delete(p)
        audit(db, user, "dwh_project_deleted", project_id)
        db.commit()
    return {"ok": True}


class ImportInput(Input):
    source_id: int = Field(gt=0)
    version: int = Field(ge=1)
    table_keys: list[str] = Field(min_length=1, max_length=50)


def safe_name(value, used):
    name = re.sub("[^a-z0-9_]", "_", value.casefold())
    if not name or name[0].isdigit():
        name = "n_" + name
    name = name[:63]
    candidate = name
    suffix = 2
    while candidate.casefold() in used:
        candidate = name[:57] + "_" + str(suffix)
        suffix += 1
    used.add(candidate.casefold())
    return candidate


@router.post("/{project_id}/import")
def import_source(project_id: int, body: ImportInput, user: User = Depends(current)):
    with scan_lock, Session() as db:
        project = project_access(db, user, project_id, edit=True)
        data = as_input(db, project)
        if body.version != project.version:
            raise HTTPException(
                409, "Projekt wurde inzwischen geändert. Bitte neu laden."
            )
        if body.source_id not in data.source_ids:
            raise HTTPException(422, "Die Quelle gehört nicht zum Projekt.")
        snap = latest(db, body.source_id)
        if not snap:
            raise HTTPException(
                422, "Die Quelle benötigt einen erfolgreichen Schema-Scan."
            )
        available = {t["key"]: t for t in snap.payload["tables"]}
        if len(set(body.table_keys)) != len(body.table_keys) or any(
            k not in available for k in body.table_keys
        ):
            raise HTTPException(
                422, "Bitte vorhandene Quellobjekte eindeutig auswählen."
            )
        selected = [available[k] for k in body.table_keys]
        if (
            len(data.tables) + len(selected) > 100
            or any(len(t["columns"]) > 200 for t in selected)
            or sum(len(t.columns) for t in data.tables)
            + sum(len(t["columns"]) for t in selected)
            > 3000
        ):
            raise HTTPException(
                422,
                "Projektlimit: 100 Tabellen, 200 Spalten je Tabelle und insgesamt 3.000 Spalten.",
            )
        names = {t.name.casefold() for t in data.tables}
        warnings = []
        for key in body.table_keys:
            t = available[key]
            cols = []
            colnames = set()
            for c in t["columns"]:
                target_name = safe_name(c["name"], colnames)
                inferred, warning = inferred_type(c["type"])
                pk = bool(c.get("primary_key"))
                if pk and (
                    inferred["data_type"] in {"text", "binary"}
                    or inferred.get("length", 0) > 190
                ):
                    pk = False
                    warning = (
                        warning
                        + " Primärschlüssel nicht übernommen; Zieltyp und Schlüssel prüfen."
                    ).strip()
                if warning:
                    warnings.append(f'{t["name"]}.{c["name"]}: {warning}')
                cols.append(
                    ColumnPlan(
                        name=target_name,
                        **inferred,
                        nullable=False if pk else bool(c.get("nullable", True)),
                        primary_key=pk,
                        purpose="business_key" if pk else "attribute",
                        description=(c.get("comment") or "")[:2000],
                        mapping=Mapping(
                            source_id=body.source_id,
                            snapshot_id=snap.id,
                            table_key=key,
                            column_name=c["name"],
                        ),
                    )
                )
            data.tables.append(
                TablePlan(
                    name=safe_name("stg_" + t["name"], names),
                    description=(t.get("comment") or "")[:4000],
                    columns=cols,
                )
            )
        # Re-validate collection limits after extending the already validated project.
        try:
            data = ProjectInput.model_validate(data.model_dump(mode="json"))
        except ValidationError:
            raise HTTPException(
                422,
                "Projektlimit erreicht: 100 Tabellen, 200 Spalten je Tabelle und insgesamt 3.000 Spalten.",
            )
        result = store_project(db, user, project, data)
        return {"project": result, "warnings": warnings, "snapshot_id": snap.id}


@router.get("/{project_id}/compare")
def compare_project(project_id: int, user: User = Depends(current)):
    with Session() as db:
        p = project_access(db, user, project_id)
        if not p.target_source_id:
            raise HTTPException(
                422, "Bitte zuerst eine Zieldatenquelle im Projekt auswählen."
            )
        target = db.get(Source, p.target_source_id)
        if not target or target.kind != p.target_kind:
            raise HTTPException(
                422, "Zieldatenquelle passt nicht mehr zur geplanten Plattform."
            )
        snap = latest(db, p.target_source_id)
        if not snap:
            raise HTTPException(
                422, "Die Zieldatenquelle benötigt einen erfolgreichen Schema-Scan."
            )
        return compare_target(as_input(db, p), snap)


@router.get("/{project_id}/export")
def export_project(
    project_id: int, format: str = "json", user: User = Depends(current)
):
    with Session() as db:
        p = project_access(db, user, project_id)
        data = as_input(db, p)
        if format == "sql":
            try:
                content = sql_script(data)
            except ValueError as error:
                raise HTTPException(422, str(error))
            media = "application/sql"
        elif format == "json":
            content = json.dumps(
                project_json(db, user, p), ensure_ascii=False, indent=2, default=str
            )
            media = "application/json"
        elif format == "markdown":

            def text(v):
                return str(v or "").replace("\n", " ").replace("|", "\\|")

            lines = [
                f"# {text(p.name)}",
                f"\n{p.goal}\n",
                f"Ziel: {p.target_kind} / {p.target_schema} · Projektversion {p.version}",
                "\nFeldzuordnungen und Transformationen sind Planungsangaben.\n",
            ]
            by_id = {t.id: t for t in data.tables}
            for t in data.tables:
                lines += [
                    f"## {t.name}",
                    f"{ROLES[t.role]} · {LAYERS[t.layer]} · {STATUSES[t.status]}",
                    f"Granularität: {text(t.grain)}",
                    text(t.description),
                    f"Laden: {t.load_mode} · {text(t.load_strategy)}",
                    "\n| Zielfeld | Typ | Zweck | Quelle / Scan | Transformation | Beschreibung |",
                    "|---|---|---|---|---|---|",
                ]
                for c in t.columns:
                    m = c.mapping
                    source = (
                        f"#{m.source_id} {m.table_key}.{m.column_name} / #{m.snapshot_id}"
                        if m
                        else "Abgeleitet / manuell"
                    )
                    lines.append(
                        f"| {c.name} | {c.data_type} | {c.purpose} | {text(source)} | {text(c.transformation)} | {text(c.description)} |"
                    )
                for r in t.relations:
                    lines.append(
                        f'\nFK {", ".join(r.columns)} → {by_id[r.target_table_id].name} ({", ".join(r.target_columns)})'
                    )
            lines += ["\n## Offene Modellierungsfragen"] + [
                f"- {text(i)}" for i in planning_issues(data) + mapping_issues(db, data)
            ]
            content = "\n".join(lines) + "\n"
            media = "text/markdown"
        else:
            raise HTTPException(422, "Exportformat: json, markdown oder sql.")
        audit(db, user, "dwh_project_exported", project_id)
        db.commit()
        suffix = "md" if format == "markdown" else format
        return Response(
            content,
            media_type=media,
            headers={
                "Content-Disposition": f'attachment; filename="databasedoc-dwh-{project_id}.{suffix}"'
            },
        )
