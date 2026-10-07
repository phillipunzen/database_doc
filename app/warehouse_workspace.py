"""Central warehouse models with shared subject areas and manual operational checks."""

import json
from datetime import date
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import Field, model_validator, ValidationError
from sqlalchemy import select, update

from .i18n import tr
from .jobs import scan_lock
from .models import Session, Source, User, WarehouseProject, WarehouseWorkspace, now
from .security import current, audit
from .warehouse import (
    Input,
    ProjectInput,
    TablePlan,
    compare_target,
    type_signature,
    identifier,
)
from .warehouse_api import (
    allowed,
    project_access,
    project_json,
    as_input,
    latest,
    store_project,
)

router = APIRouter(prefix="/api/dwh/warehouses")


class Area(Input):
    id: UUID = Field(default_factory=uuid4)
    name: str = Field(min_length=1, max_length=190)
    goal: str = Field(default="", max_length=10000)
    owner: str = Field(default="", max_length=190)
    table_ids: list[UUID] = Field(default_factory=list, max_length=300)

    @model_validator(mode="after")
    def valid(self):
        self.name = self.name.strip()
        if not self.name or len(set(self.table_ids)) != len(self.table_ids):
            raise ValueError(
                tr(
                    "Teilprojekte benötigen einen Namen und eindeutige Tabellenzuordnungen."
                )
            )
        return self


class Task(Input):
    id: UUID = Field(default_factory=uuid4)
    title: str = Field(min_length=1, max_length=190)
    kind: Literal["implementation", "quality", "operations"] = "operations"
    area_id: UUID | None = None
    owner: str = Field(default="", max_length=190)
    due_date: date | None = None
    status: Literal["open", "in_progress", "done"] = "open"
    notes: str = Field(default="", max_length=4000)

    @model_validator(mode="after")
    def valid(self):
        self.title = self.title.strip()
        if not self.title:
            raise ValueError(tr("Bitte einen Aufgabentitel angeben."))
        if self.status == "done" and not self.notes.strip():
            raise ValueError(
                tr("Bei erledigten Aufgaben bitte das Ergebnis dokumentieren.")
            )
        return self


class Content(Input):
    areas: list[Area] = Field(default_factory=list, max_length=100)
    tasks: list[Task] = Field(default_factory=list, max_length=300)

    @model_validator(mode="after")
    def valid(self):
        ids = {area.id for area in self.areas}
        if len(ids) != len(self.areas) or len(
            {a.name.casefold() for a in self.areas}
        ) != len(self.areas):
            raise ValueError(tr("Teilprojekte müssen eindeutige Namen und IDs haben."))
        if len({task.id for task in self.tasks}) != len(self.tasks) or any(
            task.area_id and task.area_id not in ids for task in self.tasks
        ):
            raise ValueError(
                tr("Aufgaben benötigen eindeutige IDs und gültige Teilprojekte.")
            )
        return self


class MetadataInput(Content):
    version: int = Field(ge=1)


class LinkInput(Input):
    project_id: int = Field(gt=0)
    version: int = Field(ge=1)


class ModelInput(Input):
    project: ProjectInput
    area_id: UUID | None = None


class AdoptInput(LinkInput):
    source_version: int = Field(ge=1)
    area_name: str = Field(min_length=1, max_length=190)
    reuse: dict[UUID, UUID] = Field(default_factory=dict, max_length=300)

    @model_validator(mode="after")
    def valid(self):
        self.area_name = self.area_name.strip()
        if not self.area_name:
            raise ValueError(
                tr(
                    "Teilprojekte benötigen einen Namen und eindeutige Tabellenzuordnungen."
                )
            )
        return self


class StarterInput(Input):
    version: int = Field(ge=1)
    area_id: UUID
    fact_name: str = Field(min_length=1, max_length=63)
    grain: str = Field(min_length=1, max_length=2000)
    measure_name: str = Field(min_length=1, max_length=63)
    measure_description: str = Field(min_length=1, max_length=2000)


def workspace_access(db, user, workspace_id, edit=False):
    workspace = db.get(WarehouseWorkspace, workspace_id)
    if not workspace:
        raise HTTPException(404, tr("Warehouse nicht verfügbar."))
    project = project_access(db, user, workspace.project_id, edit)
    return workspace, project


def check_version(project, version):
    if version != project.version:
        raise HTTPException(
            409, tr("Das Warehouse wurde inzwischen geändert. Bitte neu laden.")
        )


def validate_content(content, project):
    try:
        content = Content.model_validate(content)
    except ValidationError:
        raise HTTPException(
            422, tr("Bitte eindeutige Teilprojekte und gültige Aufgaben angeben.")
        ) from None
    ids = {table.id for table in project.tables}
    if any(
        table_id not in ids for area in content.areas for table_id in area.table_ids
    ):
        raise HTTPException(
            422,
            tr(
                "Teilprojekte dürfen nur Tabellen aus dem zentralen Zielmodell verwenden."
            ),
        )
    return content.model_dump(mode="json")


def save_content(db, user, workspace, project, content, version):
    check_version(project, version)
    content = validate_content(content, as_input(db, project))
    result = db.execute(
        update(WarehouseProject)
        .where(WarehouseProject.id == project.id, WarehouseProject.version == version)
        .values(version=version + 1, updated=now())
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise HTTPException(
            409, tr("Das Warehouse wurde inzwischen geändert. Bitte neu laden.")
        )
    workspace.content = content
    db.expire(project)
    audit(db, user, "warehouse_updated", workspace.id)
    db.commit()
    return workspace_json(db, user, workspace, project)


def workspace_json(db, user, workspace, project, detail=True):
    result = {
        "id": workspace.id,
        "project": project_json(db, user, project, detail),
        **workspace.content,
    }
    if detail:
        target = (
            db.get(Source, project.target_source_id)
            if project.target_source_id
            else None
        )
        snapshot = (
            latest(db, target.id)
            if target and target.kind == project.target_kind
            else None
        )
        result["comparison"] = (
            compare_target(as_input(db, project), snapshot) if snapshot else None
        )
    return result


def initial_content():
    titles = [
        ("SQL-Entwurf prüfen und im Zielsystem ausführen", "implementation"),
        ("Ladejob implementieren und Fehlerbehandlung testen", "implementation"),
        ("Kennzahlen mit der Quelle abstimmen", "quality"),
        ("Aktualität und fehlgeschlagene Ladejobs prüfen", "operations"),
        ("Backup und Wiederherstellung des Zielsystems testen", "operations"),
    ]
    return Content(
        tasks=[Task(title=tr(title), kind=kind) for title, kind in titles]
    ).model_dump(mode="json")


@router.get("")
def list_warehouses(user: User = Depends(current)):
    with Session() as db:
        result = []
        for workspace in db.scalars(
            select(WarehouseWorkspace).order_by(WarehouseWorkspace.id.desc())
        ):
            project = db.get(WarehouseProject, workspace.project_id)
            if project and allowed(db, user, project):
                result.append(workspace_json(db, user, workspace, project, False))
        return result


@router.post("")
def create_warehouse(body: ProjectInput, user: User = Depends(current)):
    if user.role not in {"admin", "editor"}:
        raise HTTPException(
            403, tr("Nur Administratoren und Bearbeiter können DWH-Projekte anlegen.")
        )
    with scan_lock, Session() as db:
        project = WarehouseProject()
        store_project(db, user, project, body, commit=False)
        workspace = WarehouseWorkspace(project_id=project.id, content=initial_content())
        db.add(workspace)
        db.flush()
        audit(db, user, "warehouse_created", workspace.id)
        db.commit()
        return workspace_json(db, user, workspace, project)


@router.post("/from-project")
def link_project(body: LinkInput, user: User = Depends(current)):
    with scan_lock, Session() as db:
        project = project_access(db, user, body.project_id, True)
        check_version(project, body.version)
        if db.scalar(
            select(WarehouseWorkspace.id).where(
                WarehouseWorkspace.project_id == project.id
            )
        ):
            raise HTTPException(
                409, tr("Das Projekt gehört bereits zu einem zentralen Warehouse.")
            )
        workspace = WarehouseWorkspace(project_id=project.id, content=initial_content())
        db.add(workspace)
        db.flush()
        audit(db, user, "warehouse_created", workspace.id)
        db.commit()
        return workspace_json(db, user, workspace, project)


@router.get("/{workspace_id}")
def get_workspace(workspace_id: int, user: User = Depends(current)):
    with Session() as db:
        workspace, project = workspace_access(db, user, workspace_id)
        return workspace_json(db, user, workspace, project)


@router.delete("/{workspace_id}")
def remove_workspace(workspace_id: int, version: int, user: User = Depends(current)):
    with scan_lock, Session() as db:
        workspace, project = workspace_access(db, user, workspace_id, True)
        check_version(project, version)
        result = db.execute(
            update(WarehouseProject)
            .where(
                WarehouseProject.id == project.id, WarehouseProject.version == version
            )
            .values(version=version + 1, updated=now())
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            raise HTTPException(
                409, tr("Das Warehouse wurde inzwischen geändert. Bitte neu laden.")
            )
        project_id = project.id
        db.delete(workspace)
        audit(db, user, "warehouse_removed", workspace_id)
        db.commit()
        return {"project_id": project_id}


@router.put("/{workspace_id}")
def update_workspace(
    workspace_id: int, body: MetadataInput, user: User = Depends(current)
):
    with scan_lock, Session() as db:
        workspace, project = workspace_access(db, user, workspace_id, True)
        return save_content(
            db,
            user,
            workspace,
            project,
            body.model_dump(exclude={"version"}, mode="json"),
            body.version,
        )


@router.put("/{workspace_id}/model")
def update_model(workspace_id: int, body: ModelInput, user: User = Depends(current)):
    with scan_lock, Session() as db:
        workspace, project = workspace_access(db, user, workspace_id, True)
        content = Content.model_validate(workspace.content)
        old_ids = {table.id for table in as_input(db, project).tables}
        if body.area_id:
            area = next((a for a in content.areas if a.id == body.area_id), None)
            if not area:
                raise HTTPException(422, tr("Teilprojekt nicht gefunden."))
            area.table_ids += [
                table.id for table in body.project.tables if table.id not in old_ids
            ]
        validated = validate_content(content.model_dump(mode="json"), body.project)
        store_project(db, user, project, body.project, commit=False)
        workspace.content = validated
        audit(db, user, "warehouse_updated", workspace.id)
        db.commit()
        return workspace_json(db, user, workspace, project)


def checked_model(data):
    try:
        return ProjectInput.model_validate(data.model_dump(mode="json"))
    except ValidationError:
        raise HTTPException(
            422,
            tr(
                "Das gemeinsame Modell überschreitet ein Limit oder enthält ungültige Beziehungen."
            ),
        ) from None


@router.post("/{workspace_id}/adopt-project")
def adopt_project(workspace_id: int, body: AdoptInput, user: User = Depends(current)):
    with scan_lock, Session() as db:
        workspace, project = workspace_access(db, user, workspace_id, True)
        check_version(project, body.version)
        original = project_access(db, user, body.project_id, True)
        if original.version != body.source_version:
            raise HTTPException(
                409,
                tr(
                    "Das zu übernehmende Projekt wurde geändert. Bitte die Übernahme neu öffnen."
                ),
            )
        if original.id == project.id or db.scalar(
            select(WarehouseWorkspace.id).where(
                WarehouseWorkspace.project_id == original.id
            )
        ):
            raise HTTPException(
                422, tr("Bitte ein eigenständiges Projekt zur Übernahme auswählen.")
            )
        model, incoming = as_input(db, project), as_input(db, original)
        if model.target_kind != incoming.target_kind:
            raise HTTPException(
                422, tr("Die Projekte müssen dieselbe Zielplattform verwenden.")
            )
        existing = {table.id: table for table in model.tables}
        source_ids = {table.id for table in incoming.tables}
        if any(
            left not in source_ids or right not in existing
            for left, right in body.reuse.items()
        ) or len(set(body.reuse.values())) != len(body.reuse):
            raise HTTPException(
                422, tr("Bitte gültige, eindeutige gemeinsame Tabellen auswählen.")
            )
        remap = {
            table.id: body.reuse.get(table.id, uuid4()) for table in incoming.tables
        }
        for table in incoming.tables:
            if table.id in body.reuse:
                target = existing[body.reuse[table.id]]
                signature = lambda t: [
                    (
                        c.name,
                        type_signature(c),
                        c.nullable,
                        c.primary_key,
                        c.identity,
                        c.purpose,
                    )
                    for c in t.columns
                ]
                relationships = lambda t: {
                    (tuple(r.columns), r.target_table_id, tuple(r.target_columns))
                    for r in t.relations
                }
                if table.role != target.role or signature(table) != signature(target):
                    raise HTTPException(
                        422,
                        tr(
                            "Gemeinsame Tabellen benötigen dieselben Spalten, Typen und Schlüssel."
                        ),
                    )
                mapped = table.model_copy(deep=True)
                for relation in mapped.relations:
                    relation.target_table_id = remap[relation.target_table_id]
                if relationships(mapped) != relationships(target):
                    raise HTTPException(
                        422,
                        tr(
                            "Die Beziehungen der gemeinsamen Tabelle stimmen nicht überein."
                        ),
                    )
                continue
            if any(t.name.casefold() == table.name.casefold() for t in model.tables):
                raise HTTPException(
                    422,
                    tr(
                        "Tabellenname bereits vorhanden. Bitte bewusst eine gemeinsame Tabelle auswählen oder die Quelltabelle umbenennen."
                    ),
                )
            copied = table.model_copy(deep=True)
            copied.id = remap[table.id]
            for column in copied.columns:
                column.id = uuid4()
            for relation in copied.relations:
                relation.id = uuid4()
                relation.target_table_id = remap[relation.target_table_id]
            model.tables.append(copied)
        model.source_ids = sorted(set(model.source_ids + incoming.source_ids))
        model = checked_model(model)
        content = Content.model_validate(workspace.content)
        content.areas.append(
            Area(
                name=body.area_name, goal=incoming.goal, table_ids=list(remap.values())
            )
        )
        validated = validate_content(content.model_dump(mode="json"), model)
        store_project(db, user, project, model, commit=False)
        workspace.content = validated
        audit(db, user, "warehouse_project_adopted", workspace.id)
        db.commit()
        return workspace_json(db, user, workspace, project)


@router.post("/{workspace_id}/starter")
def starter_model(workspace_id: int, body: StarterInput, user: User = Depends(current)):
    try:
        identifier(body.fact_name)
        identifier(body.measure_name)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    if (
        not body.grain.strip()
        or not body.measure_description.strip()
        or body.measure_name.casefold() in {"id", "date_id"}
    ):
        raise HTTPException(
            422, tr("Bitte Zeilenbedeutung, Kennzahl und Einheit angeben.")
        )
    with scan_lock, Session() as db:
        workspace, project = workspace_access(db, user, workspace_id, True)
        check_version(project, body.version)
        model = as_input(db, project)
        content = Content.model_validate(workspace.content)
        area = next((a for a in content.areas if a.id == body.area_id), None)
        if not area:
            raise HTTPException(422, tr("Teilprojekt nicht gefunden."))
        if (
            any(t.name.casefold() == body.fact_name.casefold() for t in model.tables)
            or body.fact_name.casefold() == "dim_date"
        ):
            raise HTTPException(422, tr("Tabellenname bereits vorhanden."))
        calendar = next(
            (t for t in model.tables if t.name.casefold() == "dim_date"), None
        )
        if not calendar:
            calendar = TablePlan(
                name="dim_date",
                role="dimension",
                layer="core",
                grain=tr("Eine Zeile je Kalendertag"),
                columns=[
                    {
                        "name": "id",
                        "data_type": "bigint",
                        "nullable": False,
                        "primary_key": True,
                        "identity": True,
                        "purpose": "technical_key",
                    },
                    {
                        "name": "calendar_date",
                        "data_type": "date",
                        "nullable": False,
                        "purpose": "business_key",
                    },
                ],
            )
            model.tables.append(calendar)
        keys = [column for column in calendar.columns if column.primary_key]
        if (
            calendar.role != "dimension"
            or len(keys) != 1
            or keys[0].data_type not in {"int", "bigint"}
        ):
            raise HTTPException(
                422,
                tr(
                    "Die vorhandene dim_date benötigt eine Dimension mit einem einzelnen INT- oder BIGINT-Primärschlüssel."
                ),
            )
        fact = TablePlan(
            name=body.fact_name,
            role="fact",
            layer="core",
            grain=body.grain,
            description=tr(
                "Startentwurf: Quellfelder, fachliche Definitionen und Ladeverfahren vor der Umsetzung prüfen."
            ),
            columns=[
                {
                    "name": "id",
                    "data_type": "bigint",
                    "nullable": False,
                    "primary_key": True,
                    "identity": True,
                    "purpose": "technical_key",
                },
                {"name": "date_id", "data_type": keys[0].data_type, "nullable": False},
                {
                    "name": body.measure_name,
                    "data_type": "decimal",
                    "nullable": False,
                    "purpose": "measure",
                    "description": body.measure_description,
                },
            ],
            relations=[
                {
                    "columns": ["date_id"],
                    "target_table_id": calendar.id,
                    "target_columns": [keys[0].name],
                }
            ],
        )
        model.tables.append(fact)
        area.table_ids = list(dict.fromkeys(area.table_ids + [calendar.id, fact.id]))
        model = checked_model(model)
        validated = validate_content(content.model_dump(mode="json"), model)
        store_project(db, user, project, model, commit=False)
        workspace.content = validated
        audit(db, user, "warehouse_updated", workspace.id)
        db.commit()
        return workspace_json(db, user, workspace, project)


@router.get("/{workspace_id}/export")
def export_workspace(workspace_id: int, user: User = Depends(current)):
    with Session() as db:
        workspace, project = workspace_access(db, user, workspace_id)
        content = json.dumps(
            workspace_json(db, user, workspace, project),
            ensure_ascii=False,
            indent=2,
            default=str,
        )
        audit(db, user, "dwh_project_exported", project.id)
        db.commit()
        return Response(
            content,
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="databasedoc-warehouse-{workspace_id}.json"'
            },
        )
