"""Warehouse planning, dialect generation, access isolation and schema verification."""

import copy
import json
import os
import time
from uuid import uuid4
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, create_engine
from sqlalchemy.orm import Session as DBSession
from pydantic import ValidationError
from app.main import app, login_attempts, SourceInput, cfg
from app.models import (
    Session,
    Source,
    Snapshot,
    WarehouseProject,
    WarehouseProjectSource,
    Base,
)
from app.warehouse import ProjectInput, sql_script, compare_target, inferred_type


def uid():
    return str(uuid4())


def source_table(name="customers", schema=""):
    return {
        "key": json.dumps([schema, name], separators=(",", ":")),
        "name": name,
        "schema": schema,
        "kind": "table",
        "columns": [
            {"name": "id", "type": "INTEGER", "nullable": False, "primary_key": True},
            {
                "name": "name",
                "type": "VARCHAR(100)",
                "nullable": True,
                "primary_key": False,
            },
        ],
        "primary_key": ["id"],
        "foreign_keys": [],
        "indexes": [],
        "unique_constraints": [],
    }


def blueprint(kind="postgresql"):
    customer, sale = uid(), uid()
    return {
        "name": "Sales warehouse",
        "goal": "Daily net sales by customer; retain customer history.",
        "target_kind": kind,
        "target_schema": "warehouse",
        "source_ids": [],
        "target_source_id": None,
        "tables": [
            {
                "id": customer,
                "name": "dim_customer",
                "role": "dimension",
                "layer": "core",
                "grain": "One row per customer version",
                "columns": [
                    {
                        "name": "id",
                        "data_type": "bigint",
                        "nullable": False,
                        "primary_key": True,
                        "identity": True,
                        "purpose": "technical_key",
                    },
                    {
                        "name": "customer_code",
                        "data_type": "varchar",
                        "length": 100,
                        "nullable": False,
                        "purpose": "business_key",
                    },
                ],
            },
            {
                "id": sale,
                "name": "fact_sales",
                "role": "fact",
                "layer": "mart",
                "grain": "One row per order item",
                "columns": [
                    {"name": "customer_id", "data_type": "bigint", "nullable": False},
                    {
                        "name": "amount",
                        "data_type": "decimal",
                        "precision": 18,
                        "scale": 2,
                        "nullable": False,
                        "purpose": "measure",
                    },
                    {"name": "date", "data_type": "date", "nullable": False},
                    {"name": "loaded_at", "data_type": "datetime", "nullable": False},
                    {"name": "active", "data_type": "boolean", "nullable": False},
                    {"name": "external_uuid", "data_type": "uuid", "nullable": True},
                    {"name": "notes", "data_type": "text", "nullable": True},
                    {"name": "payload", "data_type": "binary", "nullable": True},
                ],
                "relations": [
                    {
                        "columns": ["customer_id"],
                        "target_table_id": customer,
                        "target_columns": ["id"],
                    }
                ],
            },
        ],
    }


@pytest.fixture(scope="module")
def client():
    login_attempts.clear()
    with TestClient(app) as c:
        r = c.post(
            "/api/auth/login",
            json={"username": "admin", "password": os.environ["ADMIN_PASSWORD"]},
        )
        assert r.status_code == 200
        c.headers["x-csrf-token"] = r.json()["csrf"]
        yield c


@pytest.fixture
def catalog(client):
    ids = []
    fixture_path = Path(os.environ["SQLITE_ROOT"]) / "warehouse-fixture.sqlite"
    fixture_path.touch()
    from app.security import encrypt

    with Session() as db:
        for kind in ("sqlite", "sqlite", "postgresql"):
            s = Source(
                name=f"Warehouse fixture {kind}",
                kind=kind,
                config_encrypted=encrypt(
                    cfg(
                        SourceInput(
                            name="Fixture",
                            kind=kind,
                            path=str(fixture_path),
                            host=(
                                "fixture.example.invalid"
                                if kind == "postgresql"
                                else ""
                            ),
                            database="warehouse" if kind == "postgresql" else "",
                            schema="warehouse" if kind == "postgresql" else "",
                            password="WAREHOUSE_CONNECTION_SECRET",
                        )
                    )
                ),
            )
            db.add(s)
            db.flush()
            ids.append(s.id)
            table = source_table(schema="warehouse" if kind == "postgresql" else "")
            if kind == "sqlite" and len(ids) == 1:
                table["columns"].append(
                    {
                        "name": "unsupported",
                        "type": "GEOMETRY",
                        "nullable": True,
                        "primary_key": False,
                    }
                )
            db.add(
                Snapshot(source_id=s.id, payload={"tables": [table], "warnings": []})
            )
        db.commit()
    yield ids
    with Session() as db:
        projects = list(db.scalars(select(WarehouseProject)))
        for p in projects:
            db.query(WarehouseProjectSource).filter_by(project_id=p.id).delete()
            db.delete(p)
        for i in ids:
            db.query(Snapshot).filter_by(source_id=i).delete()
            db.delete(db.get(Source, i))
        db.commit()


def create(client, catalog):
    data = blueprint()
    data["source_ids"] = [catalog[0]]
    data["target_source_id"] = catalog[2]
    r = client.post("/api/dwh/projects", json=data)
    assert r.status_code == 200, r.text
    return r.json()


def input_data(p):
    return {
        k: copy.deepcopy(p[k])
        for k in (
            "name",
            "goal",
            "target_kind",
            "target_schema",
            "source_ids",
            "target_source_id",
            "tables",
            "version",
        )
    }


def test_persistence_import_mapping_versions_exports_and_source_changes(
    client, catalog
):
    p = create(client, catalog)
    endpoint = f'/api/dwh/projects/{p["id"]}'
    assert client.get(endpoint).json()["tables"] == p["tables"]
    imported = client.post(
        endpoint + "/import",
        json={
            "version": p["version"],
            "source_id": catalog[0],
            "table_keys": [source_table()["key"]],
        },
    )
    assert imported.status_code == 200, imported.text
    assert "GEOMETRY" in imported.json()["warnings"][0]
    p = imported.json()["project"]
    t = p["tables"][-1]
    assert t["name"] == "stg_customers" and t["role"] == "staging"
    assert t["columns"][0]["mapping"]["column_name"] == "id"
    assert t["columns"][0]["mapping"]["snapshot_id"] == imported.json()["snapshot_id"]
    assert (
        client.post(
            endpoint + "/import",
            json={
                "version": p["version"] - 1,
                "source_id": catalog[0],
                "table_keys": [source_table()["key"]],
            },
        ).status_code
        == 409
    )
    body = input_data(p)
    body["tables"][-1]["load_mode"] = "incremental"
    body["tables"][-1]["load_strategy"] = "Watermark updated_at; replay the last day."
    body["tables"][-1]["columns"][1][
        "transformation"
    ] = "Literal rule <script>alert(1)</script>; never executed"
    saved = client.put(endpoint, json=body)
    assert saved.status_code == 200, saved.text
    assert client.put(endpoint, json=body).status_code == 409
    p = saved.json()
    assert client.get("/api/dwh/projects").json()[0]["table_count"] == 3
    for fmt in ("json", "markdown", "sql"):
        r = client.get(endpoint + "/export", params={"format": fmt})
        assert r.status_code == 200, r.text
        assert r.headers["content-disposition"].startswith(
            'attachment; filename="databasedoc-dwh-'
        )
        assert "WAREHOUSE_CONNECTION_SECRET" not in r.text
        if fmt == "sql":
            assert (
                "CREATE TABLE" in r.text
                and "<script>" not in r.text
                and "Watermark" not in r.text
            )
        else:
            assert "Watermark" in r.text and "<script>" in r.text
    with Session() as db:
        table = source_table()
        table["columns"] = table["columns"][:1]
        table["columns"][0]["type"] = "BIGINT"
        db.add(
            Snapshot(source_id=catalog[0], payload={"tables": [table], "warnings": []})
        )
        db.commit()
    p = client.get(endpoint).json()
    assert any("Quellfeld fehlt" in i for i in p["mapping_issues"])
    assert any("Quelltyp" in i for i in p["mapping_issues"])
    assert (
        p["tables"][-1]["columns"][1]["mapping"]["snapshot_id"]
        == imported.json()["snapshot_id"]
    )
    assert client.get(endpoint + "/export?format=unsupported").status_code == 422


def test_permissions_revocation_csrf_bound_target_and_source_deletion(client, catalog):
    p = create(client, catalog)
    endpoint = f'/api/dwh/projects/{p["id"]}'
    r = client.post(
        "/api/users",
        json={
            "username": f"dwh{time.time_ns()}",
            "display_name": "DWH Reader",
            "password": "warehouse-reader-password",
            "role": "viewer",
        },
    )
    user = r.json()
    with TestClient(app) as viewer:
        login = viewer.post(
            "/api/auth/login",
            json={
                "username": user["username"],
                "password": "warehouse-reader-password",
            },
        )
        viewer.headers["x-csrf-token"] = login.json()["csrf"]
        assert viewer.get("/api/dwh/projects").json() == []
        assert viewer.get(endpoint).status_code == 404
        # Source permission alone cannot reveal the project's target metadata.
        for i in (catalog[0], catalog[2]):
            assert (
                client.put(
                    f"/api/sources/{i}/grants",
                    json={"user_id": user["id"], "edit": False, "data": False},
                ).status_code
                == 200
            )
        assert viewer.get(endpoint).status_code == 200
        assert not viewer.get(endpoint).json()["can_edit"]
        assert viewer.get(endpoint + "/export?format=sql").status_code == 200
        assert viewer.get(endpoint + "/compare").status_code == 200
        assert viewer.put(endpoint, json=input_data(p)).status_code == 404
        assert viewer.post("/api/dwh/projects", json=blueprint()).status_code == 403
        assert (
            viewer.post(
                endpoint + "/import",
                json={
                    "version": p["version"],
                    "source_id": catalog[0],
                    "table_keys": [source_table()["key"]],
                },
            ).status_code
            == 404
        )
        assert (
            client.delete(f'/api/sources/{catalog[2]}/grants/{user["id"]}').status_code
            == 200
        )
        assert viewer.get(endpoint + "/export?format=sql").status_code == 404
        assert viewer.get(endpoint + "/compare").status_code == 404
    assert (
        client.put(
            endpoint, json=input_data(p), headers={"x-csrf-token": ""}
        ).status_code
        == 403
    )
    assert client.delete(f"/api/sources/{catalog[0]}").status_code == 409
    assert (
        client.delete(endpoint, params={"version": p["version"] - 1}).status_code == 409
    )
    assert client.delete(endpoint, params={"version": p["version"]}).status_code == 200
    with Session() as db:
        assert not db.scalar(
            select(WarehouseProjectSource).where(
                WarehouseProjectSource.project_id == p["id"]
            )
        )


def test_bound_source_mapping_and_target_validation(client, catalog):
    p = create(client, catalog)
    endpoint = f'/api/dwh/projects/{p["id"]}'
    body = input_data(p)
    with Session() as db:
        other = db.scalar(select(Snapshot).where(Snapshot.source_id == catalog[1]))
        sid = other.id
    body["tables"][0]["columns"][0]["mapping"] = {
        "source_id": catalog[0],
        "snapshot_id": sid,
        "table_key": source_table()["key"],
        "column_name": "id",
    }
    assert client.put(endpoint, json=body).status_code == 422
    body["tables"][0]["columns"][0]["mapping"]["source_id"] = catalog[1]
    assert client.put(endpoint, json=body).status_code == 422
    body["tables"][0]["columns"][0]["mapping"] = None
    body["target_kind"] = "mssql"
    assert client.put(endpoint, json=body).status_code == 422
    body["target_kind"] = "postgresql"
    body["tables"][0]["name"] = "x]; DROP TABLE users;--"
    assert client.put(endpoint, json=body).status_code == 422
    body["tables"][0]["name"] = "dim_customer"
    body["tables"][0]["columns"][0]["data_type"] = "INT); DROP TABLE users;--"
    assert client.put(endpoint, json=body).status_code == 422
    assert client.get(endpoint).json()["version"] == p["version"]


@pytest.mark.parametrize(
    "kind,identity,text,uuid",
    [
        ("mssql", "IDENTITY", "NVARCHAR(max)", "UNIQUEIDENTIFIER"),
        ("postgresql", "GENERATED BY DEFAULT AS IDENTITY", "TEXT", "UUID"),
        ("mariadb", "AUTO_INCREMENT", "LONGTEXT", "CHAR(36)"),
    ],
)
def test_dialect_generation_all_types_and_relations(kind, identity, text, uuid):
    body = ProjectInput.model_validate(blueprint(kind))
    sql = sql_script(body)
    assert identity in sql and text in sql and uuid in sql
    assert " DATE NOT NULL" in sql
    assert "ALTER TABLE" in sql and "FOREIGN KEY" in sql
    assert sql.index("ALTER TABLE") > sql.rindex("CREATE TABLE")
    assert "DROP " not in sql and "INSERT " not in sql
    # An integer PK without explicit identity must not become SERIAL/AUTO_INCREMENT.
    body.tables[0].columns[0].identity = False
    plain = sql_script(body)
    assert identity not in plain
    if kind == "postgresql":
        assert "SERIAL" not in plain


def test_invalid_relationships_and_model_limits():
    data = blueprint()
    data["tables"][1]["relations"][0]["target_columns"] = ["customer_code"]
    with pytest.raises(ValidationError):
        ProjectInput.model_validate(data)
    data = blueprint()
    data["tables"][1]["columns"][0]["data_type"] = "int"
    with pytest.raises(ValidationError):
        ProjectInput.model_validate(data)
    data = blueprint()
    data["tables"][0]["columns"][0]["nullable"] = True
    with pytest.raises(ValidationError):
        ProjectInput.model_validate(data)
    data = blueprint()
    data["tables"][0]["columns"][0]["primary_key"] = False
    with pytest.raises(ValidationError):
        ProjectInput.model_validate(data)
    data = blueprint()
    data["tables"][0]["columns"] = []
    data["tables"][1]["relations"] = []
    with pytest.raises(ValueError):
        sql_script(ProjectInput.model_validate(data))


def test_target_comparison_detects_types_nullability_pk_relations_and_extras():
    from types import SimpleNamespace

    data = blueprint()
    project = ProjectInput.model_validate(data)
    dim = source_table("dim_customer", "warehouse")
    dim["columns"] = [
        {"name": "id", "type": "BIGINT", "nullable": False},
        {"name": "customer_code", "type": "VARCHAR(100)", "nullable": False},
    ]
    snap = SimpleNamespace(id=99, created="2026-10-06", payload={"tables": [dim]})
    result = compare_target(project, snap)
    assert result["matched"] == 1 and result["total"] == 2
    assert "Tabelle fehlt" in result["tables"][1]["issues"][0]
    dim["columns"][1]["type"] = "VARCHAR(200)"
    dim["columns"][1]["nullable"] = True
    dim["primary_key"] = []
    result = compare_target(project, snap)
    assert result["matched"] == 0
    assert len(result["tables"][0]["issues"]) == 3
    for kind in ("mssql", "postgresql", "mariadb"):
        assert inferred_type("FLOAT")[1]  # no silently invented decimal precision


def test_additive_schema_retains_legacy_catalog(tmp_path):
    engine = create_engine("sqlite:///" + str(tmp_path / "warehouse-migration.sqlite"))
    old = [
        t for t in Base.metadata.sorted_tables if not t.name.startswith("warehouse_")
    ]
    Base.metadata.create_all(engine, tables=old)
    with DBSession(engine) as db:
        db.add(
            Source(name="Existing", kind="sqlite", config_encrypted="retain-ciphertext")
        )
        db.commit()
    Base.metadata.create_all(engine)
    Base.metadata.create_all(engine)
    with DBSession(engine) as db:
        assert db.scalar(select(Source)).config_encrypted == "retain-ciphertext"
        assert db.scalar(select(WarehouseProject)) is None


def test_mariadb_boolean_and_unsigned_scan_types_are_retained():
    from sqlalchemy.dialects.mysql import TINYINT, BIGINT
    from app.connectors import documented_type

    assert documented_type(TINYINT(display_width=1)) == "TINYINT(1)"
    assert inferred_type(documented_type(TINYINT(display_width=1)))[0] == {
        "data_type": "boolean"
    }
    assert "UNSIGNED" in documented_type(BIGINT(unsigned=True))
    assert inferred_type(documented_type(BIGINT(unsigned=True)))[1]


def test_sql_server_unbounded_unicode_and_postgres_timestamps_are_recognized():
    from sqlalchemy.dialects import mssql, postgresql
    from app.connectors import documented_type

    value = documented_type(
        mssql.NVARCHAR(None, collation="SQL_Latin1_General_CP1_CI_AS"), mssql.dialect()
    )
    assert inferred_type(value) == ({"data_type": "text"}, "")
    value = documented_type(postgresql.TIMESTAMP(timezone=False), postgresql.dialect())
    assert inferred_type(value) == ({"data_type": "datetime"}, "")
    assert inferred_type("TIMESTAMP WITH TIME ZONE")[1]


def test_bound_source_identity_changes_preserve_pinned_scans(client, catalog):
    p = create(client, catalog)
    endpoint = f'/api/dwh/projects/{p["id"]}'
    imported = client.post(
        endpoint + "/import",
        json={
            "version": p["version"],
            "source_id": catalog[0],
            "table_keys": [source_table()["key"]],
        },
    )
    assert imported.status_code == 200
    p = imported.json()["project"]
    fixture_path = Path(os.environ["SQLITE_ROOT"]) / "warehouse-fixture.sqlite"
    body = {"name": "Renamed source", "kind": "sqlite", "path": str(fixture_path)}
    assert client.put(f"/api/sources/{catalog[0]}", json=body).status_code == 200
    other = Path(os.environ["SQLITE_ROOT"]) / "warehouse-other.sqlite"
    other.touch()
    body["path"] = str(other)
    assert client.put(f"/api/sources/{catalog[0]}", json=body).status_code == 409
    assert client.get(endpoint).json()["tables"] == p["tables"]
    with Session() as db:
        assert db.get(Snapshot, imported.json()["snapshot_id"]) is not None
