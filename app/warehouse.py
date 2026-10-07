"""Portable warehouse blueprints. Compile SQL only; never execute source/target SQL."""

import re
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import (
    MetaData,
    Table,
    Column,
    Integer,
    BigInteger,
    Numeric,
    Unicode,
    Date,
    DateTime,
    Boolean,
    CHAR,
    Identity,
    ForeignKeyConstraint,
)
from sqlalchemy.dialects import mssql, postgresql, mysql
from sqlalchemy.schema import CreateTable, AddConstraint
from .i18n import tr

EngineKind = Literal["mssql", "postgresql", "mariadb"]
Identifier = str
ROLES = {
    "staging": "Staging",
    "dimension": "Dimension",
    "fact": "Fakt",
    "reference": "Referenz",
    "aggregate": "Aggregat",
}
LAYERS = {"raw": "Raw", "staging": "Staging", "core": "Core", "mart": "Data Mart"}
STATUSES = {
    "planned": "Geplant",
    "in_progress": "In Umsetzung",
    "implemented": "Umgesetzt",
    "accepted": "Fachlich abgenommen",
}


def identifier(value):
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,62}", value):
        raise ValueError(
            tr(
                "Zielnamen: 1–63 Zeichen, Buchstaben, Ziffern und Unterstriche; mit Buchstabe oder Unterstrich beginnen."
            )
        )
    return value


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Mapping(Input):
    source_id: int = Field(gt=0)
    snapshot_id: int = Field(gt=0)
    table_key: str = Field(max_length=4096)
    column_name: str = Field(min_length=1, max_length=512)


class ColumnPlan(Input):
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
    purpose: Literal["attribute", "measure", "business_key", "technical_key"] = (
        "attribute"
    )
    description: str = Field(default="", max_length=2000)
    transformation: str = Field(default="", max_length=2000)
    mapping: Mapping | None = None

    @model_validator(mode="after")
    def valid(self):
        identifier(self.name)
        if self.scale > self.precision:
            raise ValueError(
                tr("Dezimalstellen dürfen die Präzision nicht überschreiten.")
            )
        if self.primary_key and (self.nullable or self.data_type in {"text", "binary"}):
            raise ValueError(
                tr(
                    "Primärschlüssel müssen NOT NULL sein und einen indexierbaren Datentyp haben."
                )
            )
        if self.primary_key and self.data_type == "varchar" and self.length > 190:
            raise ValueError(tr("Text-Primärschlüssel sind auf 190 Zeichen begrenzt."))
        if self.identity and (
            self.data_type not in {"int", "bigint"} or not self.primary_key
        ):
            raise ValueError(
                tr(
                    "Automatische Schlüssel benötigen INT/BIGINT und einen Primärschlüssel."
                )
            )
        return self


class RelationPlan(Input):
    id: UUID = Field(default_factory=uuid4)
    columns: list[str] = Field(min_length=1, max_length=8)
    target_table_id: UUID
    target_columns: list[str] = Field(min_length=1, max_length=8)


class TablePlan(Input):
    id: UUID = Field(default_factory=uuid4)
    name: str = Field(min_length=1, max_length=63)
    role: Literal["staging", "dimension", "fact", "reference", "aggregate"] = "staging"
    layer: Literal["raw", "staging", "core", "mart"] = "staging"
    grain: str = Field(default="", max_length=2000)
    description: str = Field(default="", max_length=4000)
    load_mode: Literal["full", "incremental"] = "full"
    load_strategy: str = Field(default="", max_length=4000)
    status: Literal["planned", "in_progress", "implemented", "accepted"] = "planned"
    columns: list[ColumnPlan] = Field(default_factory=list, max_length=200)
    relations: list[RelationPlan] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def valid(self):
        identifier(self.name)
        if len({c.name.casefold() for c in self.columns}) != len(self.columns):
            raise ValueError(
                tr("Spaltennamen müssen innerhalb einer Tabelle eindeutig sein.")
            )
        if len({c.id for c in self.columns}) != len(self.columns):
            raise ValueError(tr("Spalten-IDs müssen eindeutig sein."))
        if sum(c.identity for c in self.columns) > 1:
            raise ValueError(
                tr("Pro Tabelle ist höchstens ein automatischer Schlüssel erlaubt.")
            )
        return self


class ProjectInput(Input):
    name: str = Field(min_length=1, max_length=190)
    goal: str = Field(default="", max_length=10000)
    target_kind: EngineKind
    target_schema: str = Field(min_length=1, max_length=63)
    target_source_id: int | None = Field(default=None, gt=0)
    source_ids: list[int] = Field(default_factory=list, max_length=100)
    tables: list[TablePlan] = Field(default_factory=list, max_length=300)
    version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def valid(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError(tr("Bitte einen Projektnamen angeben."))
        identifier(self.target_schema)
        if any(i < 1 for i in self.source_ids) or len(set(self.source_ids)) != len(
            self.source_ids
        ):
            raise ValueError(tr("Quellen müssen eindeutig und gültig sein."))
        if len({t.name.casefold() for t in self.tables}) != len(self.tables) or len(
            {t.id for t in self.tables}
        ) != len(self.tables):
            raise ValueError(
                tr("Tabellennamen und IDs müssen im Projekt eindeutig sein.")
            )
        if sum(len(t.columns) for t in self.tables) > 30000:
            raise ValueError(
                tr("Ein Zielmodell unterstützt bis zu 30.000 Zielspalten.")
            )
        by_id = {t.id: t for t in self.tables}
        seen_relations = set()
        for table in self.tables:
            cols = {c.name: c for c in table.columns}
            for relation in table.relations:
                target = by_id.get(relation.target_table_id)
                if not target or relation.id in seen_relations:
                    raise ValueError(tr("Beziehungsziele und IDs müssen gültig sein."))
                seen_relations.add(relation.id)
                target_cols = {c.name: c for c in target.columns}
                if (
                    len(relation.columns) != len(relation.target_columns)
                    or len(set(relation.columns)) != len(relation.columns)
                    or any(n not in cols for n in relation.columns)
                    or relation.target_columns
                    != [c.name for c in target.columns if c.primary_key]
                ):
                    raise ValueError(
                        tr(
                            "Beziehungen benötigen vorhandene Spalten und den vollständigen Ziel-Primärschlüssel in gleicher Reihenfolge."
                        )
                    )
                for left, right in zip(relation.columns, relation.target_columns):
                    if type_signature(cols[left]) != type_signature(target_cols[right]):
                        raise ValueError(
                            tr(
                                "Verknüpfte Spalten müssen denselben geplanten Datentyp haben."
                            )
                        )
        return self


def type_signature(column):
    if column.data_type == "varchar":
        return ("varchar", column.length)
    if column.data_type == "decimal":
        return ("decimal", column.precision, column.scale)
    return (column.data_type,)


def dialect(kind):
    result = {"mssql": mssql, "postgresql": postgresql, "mariadb": mysql}[
        kind
    ].dialect()
    if kind == "mssql":
        # Offline compilation has no server handshake; enable modern native DATE.
        result.server_version_info = (11, 0)
    return result


def sql_type(column, kind):
    types = {
        "int": Integer(),
        "bigint": BigInteger(),
        "decimal": Numeric(column.precision, column.scale),
        "varchar": Unicode(column.length),
        "date": Date(),
        "boolean": Boolean(),
        "datetime": (
            mssql.DATETIME2(6)
            if kind == "mssql"
            else mysql.DATETIME(fsp=6) if kind == "mariadb" else DateTime()
        ),
        "text": (
            mssql.NVARCHAR(None)
            if kind == "mssql"
            else mysql.LONGTEXT() if kind == "mariadb" else postgresql.TEXT()
        ),
        "uuid": (
            mssql.UNIQUEIDENTIFIER()
            if kind == "mssql"
            else postgresql.UUID() if kind == "postgresql" else CHAR(36)
        ),
        "binary": (
            mssql.VARBINARY(None)
            if kind == "mssql"
            else mysql.LONGBLOB() if kind == "mariadb" else postgresql.BYTEA()
        ),
    }
    return types[column.data_type]


def sql_script(project):
    if not project.tables or any(not t.columns for t in project.tables):
        raise ValueError(
            tr("Für den SQL-Export benötigen alle Zieltabellen mindestens eine Spalte.")
        )
    d = dialect(project.target_kind)
    metadata = MetaData()
    tables = {}
    for plan in project.tables:
        columns = []
        for c in plan.columns:
            args = (
                [Identity()] if c.identity and project.target_kind != "mariadb" else []
            )
            columns.append(
                Column(
                    c.name,
                    sql_type(c, project.target_kind),
                    *args,
                    primary_key=c.primary_key,
                    nullable=c.nullable,
                    autoincrement=c.identity,
                    quote=True,
                )
            )
        tables[plan.id] = Table(
            plan.name,
            metadata,
            *columns,
            schema=project.target_schema,
            quote=True,
            **(
                {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"}
                if project.target_kind == "mariadb"
                else {}
            ),
        )
    constraints = []
    for plan in project.tables:
        for r in plan.relations:
            target = tables[r.target_table_id]
            fk = ForeignKeyConstraint(
                r.columns,
                [target.c[n] for n in r.target_columns],
                name="fk_" + r.id.hex,
                use_alter=True,
            )
            tables[plan.id].append_constraint(fk)
            constraints.append(fk)
    schema = d.identifier_preparer.quote_identifier(project.target_schema)
    lines = [
        "-- DatabaseDoc warehouse blueprint",
        "-- Initial schema creation only. Review before running in the intended target database.",
        "-- Mappings and transformation notes are documentation; this script does not load data.",
    ]
    if project.target_kind == "mariadb":
        lines.append(f"CREATE DATABASE IF NOT EXISTS {schema} CHARACTER SET utf8mb4;")
    elif project.target_kind == "postgresql":
        lines.append(f"CREATE SCHEMA IF NOT EXISTS {schema};")
    else:
        lines.append(
            f"IF SCHEMA_ID(N'{project.target_schema}') IS NULL EXEC(N'CREATE SCHEMA {schema}');"
        )
    for plan in project.tables:
        lines += [
            str(
                CreateTable(
                    tables[plan.id], include_foreign_key_constraints=[]
                ).compile(dialect=d)
            ).strip()
            + ";"
        ]
    lines += [
        str(AddConstraint(c).compile(dialect=d)).strip() + ";" for c in constraints
    ]
    return "\n\n".join(lines) + "\n"


def inferred_type(value):
    """Conservative portable suggestions; unsupported types remain explicit review items."""
    value = re.split(r"\s+COLLATE\s+", str(value).upper().strip(), maxsplit=1)[0]
    args = re.search(r"\((\d+)(?:\s*,\s*(\d+))?\)", value)
    base = value.split("(")[0].strip()
    if "UNSIGNED" in value:
        return {
            "data_type": "decimal",
            "precision": 20,
            "scale": 0,
        }, tr("UNSIGNED: Wertebereich und Zieltyp prüfen.")
    if base == "TINYINT" and args and int(args[1]) == 1:
        return {"data_type": "boolean"}, ""
    if base in {"INTEGER", "INT", "SMALLINT", "TINYINT", "MEDIUMINT", "INT4", "INT2"}:
        return {"data_type": "int"}, ""
    if base in {"BIGINT", "INT8"}:
        return {"data_type": "bigint"}, ""
    if base in {"NUMERIC", "DECIMAL"} and args and int(args[1]) <= 38:
        return {
            "data_type": "decimal",
            "precision": int(args[1]),
            "scale": int(args[2] or 0),
        }, ""
    if (
        base
        in {"VARCHAR", "NVARCHAR", "CHAR", "NCHAR", "CHARACTER VARYING", "CHARACTER"}
        and args
        and int(args[1]) <= 4000
    ):
        return {"data_type": "varchar", "length": int(args[1])}, ""
    if base in {"TEXT", "NTEXT", "LONGTEXT", "MEDIUMTEXT", "TINYTEXT"} or value in {
        "VARCHAR(MAX)",
        "NVARCHAR(MAX)",
    }:
        return {"data_type": "text"}, ""
    if base == "DATE":
        return {"data_type": "date"}, ""
    if (
        base
        in {
            "DATETIME",
            "DATETIME2",
            "TIMESTAMP",
            "TIMESTAMP WITHOUT TIME ZONE",
            "SMALLDATETIME",
        }
        and "WITH TIME ZONE" not in value
    ):
        return {"data_type": "datetime"}, ""
    if base in {"BOOL", "BOOLEAN", "BIT"} and (not args or int(args[1]) == 1):
        return {"data_type": "boolean"}, ""
    if base in {"UUID", "UNIQUEIDENTIFIER"}:
        return {"data_type": "uuid"}, ""
    if base in {"BYTEA", "BLOB", "LONGBLOB", "VARBINARY", "BINARY"}:
        return {"data_type": "binary"}, ""
    return {"data_type": "text"}, tr(
        "Quelltyp {0}: Zieltyp fachlich prüfen; vorläufig TEXT.", value
    )


def planning_issues(project):
    issues = []
    if not project.goal.strip():
        issues.append(tr("Fachliches Projektziel fehlt."))
    for t in project.tables:
        if not t.columns:
            issues.append(tr("{0}: Zielspalten fehlen.", t.name))
        if t.role in {"fact", "dimension", "aggregate"} and not t.grain.strip():
            issues.append(tr("{0}: Granularität fehlt.", t.name))
        if not any(c.primary_key for c in t.columns):
            issues.append(tr("{0}: Primärschlüssel noch nicht geplant.", t.name))
        if t.role == "fact" and not any(c.purpose == "measure" for c in t.columns):
            issues.append(tr("{0}: Kennzahlenspalten fehlen.", t.name))
        if t.role == "dimension" and not any(
            c.purpose == "business_key" for c in t.columns
        ):
            issues.append(tr("{0}: Fachlicher Schlüssel fehlt.", t.name))
        if t.load_mode == "incremental" and not t.load_strategy.strip():
            issues.append(tr("{0}: Inkrementelle Ladestrategie fehlt.", t.name))
    return issues


def compare_target(project, snapshot):
    actual = {(t.get("schema") or "", t["name"]): t for t in snapshot.payload["tables"]}
    results = []
    for plan in project.tables:
        table = actual.get((project.target_schema, plan.name))
        issues = []
        if table is None:
            issues.append(tr("Tabelle fehlt im gescannten Zielschema."))
        else:
            if table.get("kind") != "table":
                issues.append(tr("Das Zielobjekt ist keine Tabelle."))
            cols = {c["name"]: c for c in table["columns"]}
            for column in plan.columns:
                c = cols.get(column.name)
                if c is None:
                    issues.append(tr("{0}: Spalte fehlt.", column.name))
                    continue
                suggested, warning = inferred_type(c["type"])
                normalized = ColumnPlan(name=column.name, **suggested)
                # MariaDB uses TINYINT(1) for BOOL and CHAR(36) for portable UUIDs.
                same = type_signature(column) == type_signature(normalized)
                if project.target_kind == "mariadb":
                    same |= (
                        column.data_type == "boolean"
                        and re.fullmatch(r"TINYINT\(1\)", c["type"].upper()) is not None
                    )
                    same |= (
                        column.data_type == "uuid" and c["type"].upper() == "CHAR(36)"
                    )
                if not same or warning:
                    issues.append(
                        tr(
                            "{0}: Datentyp prüfen (Soll {1} / Ist {2}).",
                            column.name,
                            str(
                                sql_type(column, project.target_kind).compile(
                                    dialect=dialect(project.target_kind)
                                )
                            ),
                            c["type"],
                        )
                    )
                if bool(c.get("nullable", True)) != column.nullable:
                    issues.append(tr("{0}: NULL-Zulässigkeit weicht ab.", column.name))
            if table.get("primary_key", []) != [
                c.name for c in plan.columns if c.primary_key
            ]:
                issues.append(tr("Primärschlüssel weicht ab."))
            by_id = {t.id: t for t in project.tables}
            for r in plan.relations:
                name = by_id[r.target_table_id].name
                if not any(
                    f.get("columns") == r.columns
                    and f.get("target_table") == name
                    and (f.get("target_schema") or project.target_schema)
                    == project.target_schema
                    and f.get("target_columns") == r.target_columns
                    for f in table.get("foreign_keys", [])
                ):
                    issues.append(tr("Beziehung zu {0} fehlt.", name))
        results.append(
            {
                "table_id": str(plan.id),
                "table_name": plan.name,
                "matches": not issues,
                "issues": issues,
                "extra_columns": (
                    [
                        c["name"]
                        for c in table["columns"]
                        if c["name"] not in {x.name for x in plan.columns}
                    ]
                    if table
                    else []
                ),
            }
        )
    return {
        "snapshot_id": snapshot.id,
        "created": snapshot.created,
        "tables": results,
        "matched": sum(r["matches"] for r in results),
        "total": len(results),
        "extra_tables": [
            t["name"]
            for t in actual.values()
            if t.get("schema") == project.target_schema
            and t["name"] not in {p.name for p in project.tables}
        ],
        "limitations": tr(
            "Strukturvergleich aus dem gespeicherten Scan; Dateninhalte, Ladeprozesse, Identity-Eigenschaften und fachliche Richtigkeit werden nicht geprüft."
        ),
    }
