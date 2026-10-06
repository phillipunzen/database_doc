import copy
import os
import sqlite3
import time
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, delete, create_engine
from sqlalchemy.orm import Session as DBSession

from app.main import app, login_attempts
from app.models import (
    Base,
    Session,
    Source,
    Snapshot,
    Job,
    Note,
    ScanSchedule,
    SearchEntry,
    SourceMetadata,
)
from app import jobs
from app.search import migrate
from app.schema_diff import compare


@pytest.fixture(scope="module")
def client():
    login_attempts.clear()
    with TestClient(app, headers={"Accept-Language": "de-DE"}) as admin:
        result = admin.post(
            "/api/auth/login",
            json={"username": "admin", "password": os.environ["ADMIN_PASSWORD"]},
        )
        assert result.status_code == 200
        admin.headers["x-csrf-token"] = result.json()["csrf"]
        yield admin


@pytest.fixture
def catalog(client):
    path = Path(os.environ["SQLITE_ROOT"]) / f"feature-{time.time_ns()}.sqlite"
    with sqlite3.connect(path) as db:
        db.executescript(
            "CREATE TABLE customer_archive (id INTEGER PRIMARY KEY, customer_email TEXT); INSERT INTO customer_archive VALUES (1, 'private-row-value');"
        )
    ids = []
    for name in ("Feature public", "Feature restricted"):
        result = client.post(
            "/api/sources",
            json={
                "name": name,
                "kind": "sqlite",
                "path": str(path),
                "password": "private-connection-password",
            },
        )
        assert result.status_code == 200
        source_id = result.json()["id"]
        assert client.post(f"/api/sources/{source_id}/scan").status_code == 202
        for _ in range(100):
            source = next(
                s for s in client.get("/api/sources").json() if s["id"] == source_id
            )
            if source["job"]["status"] == "completed":
                break
            time.sleep(0.03)
        else:
            pytest.fail("Feature fixture scan did not finish")
        ids.append(source_id)
    yield ids, path
    for source_id in ids:
        assert client.delete(f"/api/sources/{source_id}").status_code == 200
        with Session() as db:
            for model in (
                Snapshot,
                Job,
                Note,
                SourceMetadata,
                ScanSchedule,
                SearchEntry,
            ):
                assert not db.scalar(select(model).where(model.source_id == source_id))


def test_metadata_validation_permissions_and_exports(client, catalog):
    ids, _ = catalog
    endpoint = f"/api/sources/{ids[0]}/metadata"
    result = client.put(
        endpoint,
        json={
            "tags": [" Production ", "production", "Finance"],
            "owner": "Data Team",
            "owner_email": "data@example.org",
        },
    )
    assert result.json() == {
        "tags": ["Production", "Finance"],
        "owner": "Data Team",
        "owner_email": "data@example.org",
    }
    source = next(s for s in client.get("/api/sources").json() if s["id"] == ids[0])
    assert source["tags"] == ["Production", "Finance"]
    assert source["owner"] == "Data Team"
    assert client.put(endpoint, json={"tags": ["x" * 61]}).status_code == 422
    assert client.put(endpoint, json={"tags": ["bad,tag"]}).status_code == 422
    assert client.put(endpoint, json={"owner_email": "bad"}).status_code == 422
    assert (
        client.put(endpoint, json={}, headers={"x-csrf-token": ""}).status_code == 403
    )
    assert (
        client.get(f"/api/sources/{ids[0]}/export").json()["source"]["owner"]
        == "Data Team"
    )


def test_global_search_access_notes_literal_filters_and_pagination(client, catalog):
    ids, _ = catalog
    user = client.post(
        "/api/users",
        json={
            "username": f"search{time.time_ns()}",
            "display_name": "Search reader",
            "password": "search-reader-password",
            "role": "viewer",
        },
    ).json()
    viewer = TestClient(app)
    login = viewer.post(
        "/api/auth/login",
        json={"username": user["username"], "password": "search-reader-password"},
    ).json()
    viewer.headers["x-csrf-token"] = login["csrf"]
    assert viewer.get("/api/search?q=customer").json()["total"] == 0
    client.put(f"/api/sources/{ids[0]}/grants", json={"user_id": user["id"]})
    result = viewer.get("/api/search?q=customer").json()
    assert result["total"] == 3
    assert {r["source_id"] for r in result["results"]} == {ids[0]}
    assert viewer.get(f"/api/search?q=customer&source_id={ids[1]}").status_code == 403
    assert (
        viewer.put(f"/api/sources/{ids[0]}/metadata", json={"owner": "bad"}).status_code
        == 403
    )
    assert (
        viewer.put(
            f"/api/sources/{ids[0]}/schedule", json={"enabled": True}
        ).status_code
        == 403
    )
    assert viewer.get("/api/search?q=%25%25").json()["total"] == 0
    assert (
        viewer.get("/api/search?q=customer&kind=column&page_size=1&page=2").json()[
            "results"
        ][0]["kind"]
        == "column"
    )
    assert viewer.get("/api/search?q=x").status_code == 422
    snap = client.get(f"/api/sources/{ids[0]}/snapshot").json()
    key = snap["payload"]["tables"][0]["key"]
    client.put(
        f"/api/sources/{ids[0]}/notes",
        json={
            "table_key": key,
            "text": "Business glossary 100%_literal <script>alert(1)</script>",
        },
    )
    assert viewer.get("/api/search?q=business&kind=note").json()["total"] == 1
    assert viewer.get("/api/search?q=100%25_literal&kind=note").json()["total"] == 1
    assert viewer.get("/api/search?q=private-row-value").json()["total"] == 0
    assert viewer.get("/api/search?q=private-connection-password").json()["total"] == 0
    client.delete(f"/api/sources/{ids[0]}/grants/{user['id']}")
    assert viewer.get("/api/search?q=business").json()["total"] == 0
    viewer.close()


def test_schema_changes_and_search_replacement(client, catalog):
    ids, path = catalog
    before = client.get(f"/api/sources/{ids[0]}/snapshot").json()
    with sqlite3.connect(path) as db:
        db.executescript(
            "ALTER TABLE customer_archive ADD COLUMN account_status TEXT DEFAULT 'active'; CREATE INDEX ix_status ON customer_archive(account_status); CREATE TABLE new_events(id INTEGER);"
        )
    assert client.post(f"/api/sources/{ids[0]}/scan").status_code == 202
    for _ in range(100):
        after = client.get(f"/api/sources/{ids[0]}/snapshot").json()
        if after["id"] != before["id"]:
            break
        time.sleep(0.03)
    delta = client.get(
        f"/api/sources/{ids[0]}/compare?before={before['id']}&after={after['id']}"
    ).json()
    assert delta["summary"]["added_tables"] == 1
    assert delta["summary"]["changed_tables"] == 1
    assert delta["changed_tables"][0]["added_columns"][0]["name"] == "account_status"
    assert "indexes" in delta["changed_tables"][0]["changes"]
    assert (
        client.get(
            f"/api/search?q=account_status&source_id={ids[0]}&kind=column"
        ).json()["total"]
        == 1
    )
    assert (
        client.get(
            f"/api/sources/{ids[1]}/compare?before={before['id']}&after={after['id']}"
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/sources/{ids[0]}/compare?before={after['id']}&after={before['id']}"
        ).status_code
        == 422
    )


def test_diff_ignores_order_but_detects_types_constraints_and_removals():
    col = {
        "name": "id",
        "type": "INT",
        "nullable": False,
        "default": None,
        "primary_key": True,
        "comment": "",
    }
    table = {
        "key": '["","example"]',
        "schema": "",
        "name": "example",
        "kind": "table",
        "columns": [col],
        "indexes": [
            {"name": "a", "columns": ["id"], "unique": False},
            {"name": "b", "columns": ["id"], "unique": True},
        ],
        "primary_key": ["id"],
        "foreign_keys": [],
        "unique_constraints": [],
    }
    old = {"tables": [table]}
    new = copy.deepcopy(old)
    new["tables"][0]["indexes"].reverse()
    assert compare(old, new)["summary"]["changed_tables"] == 0
    new["tables"][0]["columns"][0].update(
        type="BIGINT", nullable=True, default="0", comment="New comment"
    )
    new["tables"][0]["foreign_keys"] = [
        {
            "name": "fk",
            "columns": ["id"],
            "target_table": "other",
            "target_columns": ["id"],
        }
    ]
    changed = compare(old, new)["changed_tables"][0]
    assert set(changed["changed_columns"][0]["changes"]) == {
        "type",
        "nullable",
        "default",
        "comment",
    }
    assert "foreign_keys" in changed["changes"]
    assert compare(old, {"tables": []})["summary"]["removed_columns"] == 1


def test_schedule_due_restart_defer_and_revoked_permissions(
    client, catalog, monkeypatch
):
    ids, _ = catalog
    user = client.post(
        "/api/users",
        json={
            "username": f"planner{time.time_ns()}",
            "display_name": "Planner",
            "password": "planner-test-password",
            "role": "editor",
        },
    ).json()
    client.put(
        f"/api/sources/{ids[0]}/grants", json={"user_id": user["id"], "edit": True}
    )
    editor = TestClient(app)
    login = editor.post(
        "/api/auth/login",
        json={"username": user["username"], "password": "planner-test-password"},
    ).json()
    editor.headers["x-csrf-token"] = login["csrf"]
    endpoint = f"/api/sources/{ids[0]}/schedule"
    assert not client.get(endpoint).json()["enabled"]
    assert client.put(endpoint, json={"timezone": "Invalid/Zone"}).status_code == 422
    assert client.put(endpoint, json={"hour": 24}).status_code == 422
    result = editor.put(endpoint, json={"enabled": True, "cadence": "hourly"}).json()
    assert result["next_run"]
    at = datetime(2026, 10, 6, 12)
    with Session() as db:
        schedule = db.get(ScanSchedule, ids[0])
        schedule.next_run = at - timedelta(days=3)
        # Simulate an already-running manual scan: scheduler must defer, not duplicate.
        busy = Job(source_id=ids[0], status="running")
        db.add(busy)
        db.commit()
        busy_id = busy.id
    dispatched = []
    monkeypatch.setattr(jobs, "dispatch", dispatched.append)
    jobs.scheduler_tick(at)
    assert dispatched == []
    assert client.get(endpoint).json()["message"].startswith("Termin wartet")
    with Session() as db:
        db.get(Job, busy_id).status = "failed"
        db.commit()
    jobs.scheduler_tick(at)
    jobs.scheduler_tick(at)
    assert len(dispatched) == 1
    jobs.run_scan(dispatched[0])
    schedule = client.get(endpoint).json()
    assert schedule["last_job_id"] == dispatched[0]
    assert datetime.fromisoformat(schedule["next_run"]) == at + timedelta(hours=1)
    client.delete(f"/api/sources/{ids[0]}/grants/{user['id']}")
    jobs.scheduler_tick(at + timedelta(hours=2))
    assert not client.get(endpoint).json()["enabled"]
    assert len(dispatched) == 1
    assert client.get(endpoint).json()["next_run"] is None
    editor.close()


def test_schedule_dst_and_weekly_calendar():
    daily = SimpleNamespace(
        cadence="daily", timezone="Europe/Berlin", hour=2, minute=30, weekday=0
    )
    assert jobs.next_due(daily, datetime(2026, 3, 28, 23)) == datetime(
        2026, 3, 29, 1, 30
    )
    assert jobs.next_due(daily, datetime(2026, 10, 24, 23)) == datetime(
        2026, 10, 25, 0, 30
    )
    # Do not repeat the daily scan at the second autumn occurrence.
    assert jobs.next_due(daily, datetime(2026, 10, 25, 0, 30)) == datetime(
        2026, 10, 26, 1, 30
    )
    weekly = SimpleNamespace(
        cadence="weekly", timezone="Europe/Berlin", hour=8, minute=0, weekday=0
    )
    assert jobs.next_due(weekly, datetime(2026, 10, 6, 12)) == datetime(2026, 10, 12, 6)


def test_failed_scan_preserves_snapshot_and_index(client, catalog, monkeypatch):
    ids, _ = catalog
    before = client.get(f"/api/sources/{ids[0]}/snapshot").json()["id"]
    with Session() as db:
        job = Job(source_id=ids[0])
        db.add(job)
        db.commit()
        job_id = job.id

    def fail(*args):
        raise RuntimeError("sensitive-driver-details")

    monkeypatch.setattr(jobs, "reindex_source", fail)
    jobs.run_scan(job_id)
    assert client.get(f"/api/sources/{ids[0]}/snapshot").json()["id"] == before
    assert client.get(f"/api/search?q=customer&source_id={ids[0]}").json()["total"] == 3
    with Session() as db:
        job = db.get(Job, job_id)
        assert job.status == "failed"
        assert "sensitive-driver-details" not in job.message


def test_additive_migration_idempotent_retains_existing_records(tmp_path):
    legacy = create_engine("sqlite:///" + str(tmp_path / "legacy.sqlite"))
    # Create only pre-feature tables, as an existing installation would have them.
    old_tables = [
        t
        for t in Base.metadata.sorted_tables
        if t.name
        not in {
            "source_metadata",
            "scan_schedules",
            "search_entries",
            "schema_versions",
        }
    ]
    Base.metadata.create_all(legacy, tables=old_tables)
    with DBSession(legacy) as db:
        source = Source(
            name="Existing database",
            kind="sqlite",
            config_encrypted="retain-exact-ciphertext",
        )
        db.add(source)
        db.flush()
        table = {
            "key": '["","legacy"]',
            "name": "legacy",
            "schema": "",
            "comment": "Existing description",
            "columns": [{"name": "old_column", "type": "TEXT"}],
        }
        db.add(Snapshot(source_id=source.id, payload={"tables": [table]}))
        db.add(
            Note(
                source_id=source.id,
                table_key=table["key"],
                text="Existing business knowledge",
            )
        )
        db.commit()
    Base.metadata.create_all(legacy)
    with DBSession(legacy) as db:
        migrate(db)
        migrate(db)
        assert len(list(db.scalars(select(SearchEntry)))) == 3
        assert db.scalar(select(Source)).config_encrypted == "retain-exact-ciphertext"
        assert db.scalar(select(Note)).text == "Existing business knowledge"
        assert len(list(db.scalars(select(Snapshot)))) == 1
    legacy.dispose()
