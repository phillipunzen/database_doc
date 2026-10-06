import os
import time
import sqlite3
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.models import Session, Source, Snapshot, Job, Note
from app.connectors import scan, preview, relational
from app.security import decrypt


@pytest.fixture(scope="module")
def clients():
    with TestClient(app) as admin:
        result = admin.post(
            "/api/auth/login",
            json={"username": "admin", "password": os.environ["ADMIN_PASSWORD"]},
        )
        assert result.status_code == 200
        admin.headers["x-csrf-token"] = result.json()["csrf"]
        yield admin


@pytest.fixture(scope="module")
def source(clients):
    path = Path(os.environ["SQLITE_ROOT"]) / "source.sqlite"
    with sqlite3.connect(path) as db:
        db.executescript(
            'CREATE TABLE parents(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE children(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES parents(id)); CREATE VIEW parent_names AS SELECT name FROM parents; INSERT INTO parents VALUES(1,"Sensitive example");'
        )
    result = clients.post(
        "/api/sources",
        json={
            "name": "SQLite test",
            "kind": "sqlite",
            "path": str(path),
            "password": "secret-to-encrypt",
        },
    )
    assert result.status_code == 200
    return result.json()["id"]


def wait_scan(client, source_id):
    for _ in range(100):
        listing = client.get("/api/sources").json()
        source = next(s for s in listing if s["id"] == source_id)
        if source["job"] and source["job"]["status"] not in {"queued", "running"}:
            assert source["job"]["status"] == "completed", source
            return
        time.sleep(0.03)
    pytest.fail("Scan did not finish")


def test_encrypted_credentials_and_safe_listing(clients, source):
    listing = clients.get("/api/sources").json()
    assert "secret-to-encrypt" not in str(listing)
    with Session() as db:
        record = db.get(Source, source)
        assert "secret-to-encrypt" not in record.config_encrypted
        assert decrypt(record)["password"] == "secret-to-encrypt"


def test_scan_snapshot_keys_notes_export(clients, source):
    assert clients.post(f"/api/sources/{source}/test").status_code == 200
    assert clients.post(f"/api/sources/{source}/scan").status_code == 202
    wait_scan(clients, source)
    snap = clients.get(f"/api/sources/{source}/snapshot").json()
    tables = snap["payload"]["tables"]
    assert len(tables) == 3
    child = next(t for t in tables if t["name"] == "children")
    assert child["foreign_keys"][0]["target_table"] == "parents"
    assert child["columns"][0]["primary_key"] is True
    assert "Sensitive example" not in str(snap)
    assert (
        clients.put(
            f"/api/sources/{source}/notes",
            json={"table_key": child["key"], "text": "Child rows"},
        ).status_code
        == 200
    )
    assert clients.post(f"/api/sources/{source}/scan").status_code == 202
    wait_scan(clients, source)
    assert len(clients.get(f"/api/sources/{source}/history").json()) == 2
    assert (
        clients.get(f"/api/sources/{source}/snapshot").json()["notes"][child["key"]]
        == "Child rows"
    )
    exported = clients.get(f"/api/sources/{source}/export").text
    assert "secret-to-encrypt" not in exported
    assert "Sensitive example" not in exported
    assert (
        "Child rows"
        in clients.get(f"/api/sources/{source}/export?format=markdown").text
    )


def test_auth_csrf_origin_and_role_access(clients, source):
    anonymous = TestClient(app)
    assert anonymous.get("/api/sources").status_code == 401
    assert (
        clients.post(
            f"/api/sources/{source}/scan", headers={"x-csrf-token": ""}
        ).status_code
        == 403
    )
    assert (
        clients.post(
            f"/api/sources/{source}/scan", headers={"origin": "https://evil.invalid"}
        ).status_code
        == 403
    )
    created = clients.post(
        "/api/users",
        json={
            "username": "reader",
            "display_name": "Reader",
            "password": "viewer-test-password",
            "role": "viewer",
        },
    ).json()
    viewer = TestClient(app)
    login = viewer.post(
        "/api/auth/login",
        json={"username": "reader", "password": "viewer-test-password"},
    ).json()
    viewer.headers["x-csrf-token"] = login["csrf"]
    assert viewer.get("/api/sources").json() == []
    assert viewer.get(f"/api/sources/{source}/snapshot").status_code == 403
    assert (
        viewer.post(
            "/api/sources", json={"name": "bad", "kind": "sqlite", "path": "/tmp/no"}
        ).status_code
        == 403
    )
    assert (
        clients.put(
            f"/api/sources/{source}/grants", json={"user_id": created["id"]}
        ).status_code
        == 200
    )
    snap = viewer.get(f"/api/sources/{source}/snapshot").json()
    parent = next(t for t in snap["payload"]["tables"] if t["name"] == "parents")
    assert viewer.post(f"/api/sources/{source}/scan").status_code == 403
    assert (
        viewer.post(
            f"/api/sources/{source}/preview", json={"table_key": parent["key"]}
        ).status_code
        == 403
    )
    assert viewer.get("/api/users").status_code == 403
    clients.put(
        f"/api/sources/{source}/grants", json={"user_id": created["id"], "data": True}
    )
    data = viewer.post(
        f"/api/sources/{source}/preview", json={"table_key": parent["key"]}
    )
    assert data.status_code == 200
    assert data.json()["rows"][0][1] == "Sensitive example"
    assert (
        viewer.post(
            f"/api/sources/{source}/preview",
            json={"table_key": '"; DROP TABLE parents; --'},
        ).status_code
        == 404
    )
    clients.delete(f'/api/sources/{source}/grants/{created["id"]}')
    assert viewer.get(f"/api/sources/{source}/snapshot").status_code == 403


def test_editor_permissions_and_disabled_session(clients, source):
    u = clients.post(
        "/api/users",
        json={
            "username": "editor",
            "display_name": "Editor",
            "password": "editor-test-password",
            "role": "editor",
        },
    ).json()
    editor = TestClient(app)
    login = editor.post(
        "/api/auth/login",
        json={"username": "editor", "password": "editor-test-password"},
    ).json()
    editor.headers["x-csrf-token"] = login["csrf"]
    clients.put(
        f"/api/sources/{source}/grants", json={"user_id": u["id"], "edit": True}
    )
    assert editor.post(f"/api/sources/{source}/scan").status_code == 202
    wait_scan(clients, source)
    assert editor.delete(f"/api/sources/{source}").status_code == 403
    clients.put(f'/api/users/{u["id"]}', json={"role": "editor", "active": False})
    assert editor.get("/api/sources").status_code == 401
    assert (
        clients.put("/api/users/1", json={"role": "viewer", "active": True}).status_code
        == 400
    )


def test_sqlite_readonly_and_path_boundary(clients, source):
    with Session() as db:
        config = decrypt(db.get(Source, source))
    with relational("sqlite", config) as conn:
        from sqlalchemy import text

        with pytest.raises(Exception):
            conn.execute(text("DELETE FROM parents"))
    assert (
        clients.post(
            "/api/sources",
            json={"name": "outside", "kind": "sqlite", "path": "/etc/passwd"},
        ).status_code
        == 422
    )
    assert (
        clients.post(
            "/api/sources",
            json={
                "name": "escape",
                "kind": "sqlite",
                "path": os.environ["SQLITE_ROOT"] + "/../passwd",
            },
        ).status_code
        == 422
    )


def test_password_change_revokes_old_sessions(clients):
    user = clients.post(
        "/api/users",
        json={
            "username": "password-user",
            "display_name": "Password user",
            "password": "initial-test-password",
            "role": "viewer",
        },
    ).json()
    one, two = TestClient(app), TestClient(app)
    for c in [one, two]:
        result = c.post(
            "/api/auth/login",
            json={"username": user["username"], "password": "initial-test-password"},
        ).json()
        c.headers["x-csrf-token"] = result["csrf"]
    response = one.post(
        "/api/auth/password",
        json={
            "current_password": "initial-test-password",
            "password": "changed-test-password",
        },
    )
    assert response.status_code == 200
    assert two.get("/api/auth/me").status_code == 401
    assert one.get("/api/auth/me").status_code == 200


def test_delete_cascades_application_metadata(clients, source):
    assert clients.delete(f"/api/sources/{source}").status_code == 200
    with Session() as db:
        for model in [Source, Snapshot, Job, Note]:
            query = (
                select(model).where(model.id == source)
                if model == Source
                else select(model).where(model.source_id == source)
            )
            assert not list(db.scalars(query))
