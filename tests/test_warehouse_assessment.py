"""Stored warehouse evidence, server-inventory grant isolation, and read-only advice."""

import json
import os
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from app.main import app, login_attempts
from app.models import (
    Session,
    Source,
    Snapshot,
    Grant,
    User,
    WarehouseProject,
    WarehouseProjectSource,
    WarehouseWorkspace,
    Job,
    now,
)
from app.security import encrypt, hasher


def table(name="events", schema="public", fields=None):
    return {
        "key": json.dumps([schema, name]),
        "schema": schema,
        "name": name,
        "kind": "table",
        "columns": fields
        or [{"name": "id", "type": "INTEGER", "nullable": False, "primary_key": True}],
        "primary_key": ["id"],
        "foreign_keys": [],
        "indexes": [],
        "unique_constraints": [],
    }


@pytest.fixture
def fixture():
    login_attempts.clear()
    with TestClient(app) as admin:
        login = admin.post(
            "/api/auth/login",
            json={"username": "admin", "password": os.environ["ADMIN_PASSWORD"]},
        )
        assert login.status_code == 200
        admin.headers["x-csrf-token"] = login.json()["csrf"]
        with Session() as db:
            reader = User(
                username="assessment_" + uuid4().hex,
                display_name="Assessment reader",
                role="viewer",
                password_hash=hasher.hash("assessment-reader-password"),
            )
            db.add(reader)
            db.flush()
            rows = []
            for name, host, port in [
                ("Application", "app.invalid", 5432),
                ("DWH target", "dwh.invalid", 5432),
                ("Shared reporting", "DWH.INVALID.", None),
                ("PRIVATE_DATABASE_SECRET", "dwh.invalid", 5432),
                ("Other port", "dwh.invalid", 5433),
                ("Unscanned source", "app.invalid", 5432),
            ]:
                source = Source(
                    name=name,
                    kind="postgresql",
                    config_encrypted=encrypt(
                        {
                            "host": host,
                            "port": port,
                            "database": name.replace(" ", "_"),
                            "schema": "",
                            "username": "CONNECTION_USER_SECRET",
                            "password": "CONNECTION_PASSWORD_SECRET",
                        }
                    ),
                )
                db.add(source)
                db.flush()
                rows.append(source)
            original_table = table(
                fields=[
                    {
                        "name": "id",
                        "type": "INTEGER",
                        "nullable": False,
                        "primary_key": True,
                    },
                    {"name": "amount", "type": "NUMERIC(18,2)", "nullable": False},
                    {"name": "removed", "type": "INTEGER", "nullable": True},
                ]
            )
            original = Snapshot(
                source_id=rows[0].id,
                payload={"tables": [original_table], "warnings": []},
                created=now() - timedelta(days=2),
            )
            db.add(original)
            db.flush()
            sid = original.id
            changed_table = table(
                fields=[
                    {
                        "name": "id",
                        "type": "INTEGER",
                        "nullable": False,
                        "primary_key": True,
                    },
                    {"name": "amount", "type": "VARCHAR(100)", "nullable": True},
                    {"name": "new_field", "type": "TEXT", "nullable": True},
                ]
            )
            db.add(
                Snapshot(
                    source_id=rows[0].id,
                    payload={
                        "tables": [changed_table, table("new_object")],
                        "warnings": [],
                    },
                )
            )
            target_table = table(
                "fact_events",
                "warehouse",
                fields=[
                    {
                        "name": "id",
                        "type": "BIGINT",
                        "nullable": True,
                        "primary_key": False,
                    },
                    {"name": "extra", "type": "TEXT", "nullable": True},
                ],
            )
            target_table["primary_key"] = []
            for index in [1, 2, 3, 4]:
                db.add(
                    Snapshot(
                        source_id=rows[index].id,
                        payload={
                            "tables": [target_table, table("legacy", "warehouse")],
                            "warnings": (
                                ["Fixture scanner limit warning"] if index == 1 else []
                            ),
                        },
                        created=now() - timedelta(days=14) if index == 1 else now(),
                    )
                )
            db.add(
                Job(source_id=rows[1].id, status="failed", message="Fictional failure")
            )
            for source in rows[:3] + rows[4:]:
                db.add(
                    Grant(
                        source_id=source.id, user_id=reader.id, edit=False, data=False
                    )
                )
            db.commit()
            ids = [s.id for s in rows]
        model = {
            "name": "Evidence warehouse",
            "goal": "Event trends",
            "target_kind": "postgresql",
            "target_schema": "warehouse",
            "source_ids": [ids[0], ids[5]],
            "target_source_id": ids[1],
            "tables": [
                {
                    "id": str(uuid4()),
                    "name": "fact_events",
                    "columns": [
                        {
                            "name": "id",
                            "data_type": "int",
                            "nullable": False,
                            "primary_key": True,
                            "mapping": {
                                "source_id": ids[0],
                                "snapshot_id": sid,
                                "table_key": original_table["key"],
                                "column_name": "id",
                            },
                        },
                        {
                            "name": "amount",
                            "data_type": "decimal",
                            "precision": 18,
                            "scale": 2,
                            "nullable": False,
                            "mapping": {
                                "source_id": ids[0],
                                "snapshot_id": sid,
                                "table_key": original_table["key"],
                                "column_name": "amount",
                            },
                        },
                        {
                            "name": "removed",
                            "data_type": "int",
                            "mapping": {
                                "source_id": ids[0],
                                "snapshot_id": sid,
                                "table_key": original_table["key"],
                                "column_name": "removed",
                            },
                        },
                        {
                            "name": "derived",
                            "data_type": "text",
                            "transformation": "Documented derivation",
                        },
                        {"name": "unassigned", "data_type": "text"},
                    ],
                }
            ],
        }
        response = admin.post("/api/dwh/warehouses", json=model)
        assert response.status_code == 200, response.text
        workspace = response.json()
        endpoint = f'/api/dwh/projects/{workspace["project"]["id"]}/assessment'
        with TestClient(app, headers={"Accept-Language": "en-US"}) as viewer:
            login = viewer.post(
                "/api/auth/login",
                json={
                    "username": reader.username,
                    "password": "assessment-reader-password",
                },
            )
            assert login.status_code == 200
            yield admin, viewer, workspace, endpoint, ids, sid
        with Session() as db:
            db.delete(db.get(WarehouseWorkspace, workspace["id"]))
            db.query(WarehouseProjectSource).filter_by(
                project_id=workspace["project"]["id"]
            ).delete()
            db.delete(db.get(WarehouseProject, workspace["project"]["id"]))
            for source_id in ids:
                for cls in [Grant, Snapshot, Job]:
                    db.query(cls).filter_by(source_id=source_id).delete()
                db.delete(db.get(Source, source_id))
            from app.models import LoginSession

            db.query(LoginSession).filter_by(user_id=reader.id).delete()
            db.delete(db.get(User, reader.id))
            db.commit()


def test_evidence_maps_target_and_source_changes_without_credentials_or_writes(
    fixture, monkeypatch
):
    admin, viewer, workspace, endpoint, ids, sid = fixture

    def forbid(*args, **kwargs):
        raise AssertionError("Assessment must never query a source or enqueue a scan")

    monkeypatch.setattr("app.connectors.scan", forbid)
    monkeypatch.setattr("app.connectors.connection_test", forbid)
    monkeypatch.setattr("app.jobs.enqueue", forbid)
    with Session() as db:
        before = (
            db.scalar(select(func.count()).select_from(Snapshot)),
            db.scalar(select(func.count()).select_from(Job)),
            db.get(WarehouseProject, workspace["project"]["id"]).version,
        )
    response = viewer.get(endpoint)
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["project_version"] == 1
    assert (
        report["target"]["id"] == ids[1]
        and report["target"]["stale"]
        and not report["target"]["can_scan"]
    )
    assert {s["id"] for s in report["server_databases"]} == {ids[1], ids[2]}
    assert {s["id"] for s in report["sources"]} == {ids[0], ids[5]}
    assert report["sources"][0]["changes"]["before_snapshot_id"] == sid
    assert report["sources"][0]["changes"]["added_tables"] == 1
    assert report["sources"][0]["changes"]["changed_tables"] == 1
    codes = {f["code"] for f in report["findings"]}
    assert {
        "target_difference",
        "target_extra_columns",
        "target_extra_tables",
        "mapped_field_changed",
        "mapped_field_missing",
        "source_changes",
        "scan_stale",
        "scan_missing",
        "scan_failed",
        "scan_warning",
        "mapping_incomplete",
    } <= codes
    assert any(
        f["code"] == "mapping_incomplete" and "1 columns" in f["message"]
        for f in report["findings"]
    )
    assert report["comparison"]["matched"] == 0
    assert len(report["target_objects"]) == 2 and report["target_objects"][0]["planned"]
    assert (
        report["finding_counts"]["warning"] > 0 and report["finding_counts"]["info"] > 0
    )
    assert (
        "CONNECTION_PASSWORD_SECRET" not in response.text
        and "CONNECTION_USER_SECRET" not in response.text
        and "PRIVATE_DATABASE_SECRET" not in response.text
    )
    assert response.headers["cache-control"] == "no-store"
    assert {s["id"] for s in admin.get(endpoint).json()["server_databases"]} == {
        ids[1],
        ids[2],
        ids[3],
    }
    with Session() as db:
        assert before == (
            db.scalar(select(func.count()).select_from(Snapshot)),
            db.scalar(select(func.count()).select_from(Job)),
            db.get(WarehouseProject, workspace["project"]["id"]).version,
        )
        db.query(Grant).filter_by(source_id=ids[1]).delete()
        db.commit()
    assert viewer.get(endpoint).status_code == 404
    assert viewer.get("/api/dwh/warehouses").json() == []


def test_missing_target_matching_model_scan_scope_and_request_languages(fixture):
    admin, viewer, workspace, endpoint, ids, sid = fixture
    response = viewer.get(endpoint, headers={"Accept-Language": "de-DE"}).json()
    assert "älter als" in next(
        f["message"] for f in response["findings"] if f["code"] == "scan_stale"
    )
    assert "older than" in next(
        f["message"]
        for f in viewer.get(endpoint).json()["findings"]
        if f["code"] == "scan_stale"
    )
    with Session() as db:
        project = db.get(WarehouseProject, workspace["project"]["id"])
        planned = dict(project.blueprint["tables"][0])
        planned["columns"] = planned["columns"][:1]
        project.blueprint = {"tables": [planned]}
        db.add(Snapshot(source_id=ids[1], payload={"tables": [table("fact_events", "warehouse")], "warnings": []}))
        job = db.scalar(select(Job).where(Job.source_id == ids[1]))
        job.status = "completed"
        db.commit()
    matching = viewer.get(endpoint).json()
    assert matching["comparison"]["matched"] == 1
    assert not matching["target"]["stale"]
    assert not any(f["code"].startswith("target_") or f["code"] == "mapped_field_changed" for f in matching["findings"])
    with Session() as db:
        project = db.get(WarehouseProject, workspace["project"]["id"])
        project.target_source_id = None
        db.commit()
    r = viewer.get(endpoint).json()
    assert r["target"] is None and not r["server_databases"]
    assert any(f["code"] == "target_missing" for f in r["findings"])
    with Session() as db:
        project = db.get(WarehouseProject, workspace["project"]["id"])
        project.target_source_id = ids[1]
        source = db.get(Source, ids[1])
        source.config_encrypted = encrypt(
            {"host": "dwh.invalid", "database": "target", "schema": "other_schema"}
        )
        project.blueprint = {"tables": []}
        db.commit()
    r = viewer.get(endpoint).json()
    assert any(f["code"] == "target_scope" for f in r["findings"])
    assert any(f["code"] == "model_missing" for f in r["findings"])
    assert r["comparison"]["total"] == 0
    with Session() as db:
        project = db.get(WarehouseProject, workspace["project"]["id"])
        project.target_kind = "mssql"
        db.commit()
    r = viewer.get(endpoint).json()
    assert r["comparison"] is None and r["server_databases"] == []
    assert any(f["code"] == "target_kind" for f in r["findings"])


def test_unregistered_project_and_no_source_permissions(fixture):
    admin, viewer, workspace, endpoint, ids, sid = fixture
    with TestClient(app) as anonymous:
        assert anonymous.get(endpoint).status_code == 401
    assert viewer.get("/api/dwh/projects/999999/assessment").status_code == 404
    with Session() as db:
        db.query(Grant).filter_by(source_id=ids[0]).delete()
        db.commit()
    assert viewer.get(endpoint).status_code == 404
