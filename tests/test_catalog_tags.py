"""Classification consistency, access checks and atomic bulk operations."""

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app, login_attempts
from app.models import Session, SourceMetadata


@pytest.fixture(scope="module")
def admin():
    login_attempts.clear()
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": os.environ["ADMIN_PASSWORD"]},
        )
        assert login.status_code == 200
        client.headers["x-csrf-token"] = login.json()["csrf"]
        yield client


@pytest.fixture
def sources(admin):
    path = Path(os.environ["SQLITE_ROOT"]) / "classify.sqlite"
    path.touch()
    ids = [
        admin.post(
            "/api/sources", json={"name": name, "kind": "sqlite", "path": str(path)}
        ).json()["id"]
        for name in ["Classify A", "Classify B"]
    ]
    yield ids
    for source_id in ids:
        assert admin.delete(f"/api/sources/{source_id}").status_code == 200


def test_shared_style_casefold_versions_and_deletion(admin, sources):
    result = admin.put(
        "/api/catalog/tags",
        json={"name": " Test Berlin ", "color": "blue", "category": "location"},
    )
    assert result.status_code == 200
    tag = result.json()
    assert (
        admin.put(
            "/api/catalog/tags",
            json={"name": "test berlin", "color": "red", "category": "location"},
        ).status_code
        == 409
    )
    assert (
        admin.put(
            "/api/catalog/tags",
            json={"name": "bad", "color": "url(javascript:alert(1))"},
        ).status_code
        == 422
    )
    assert (
        admin.put("/api/catalog/tags", json={"name": " , ", "color": "red"}).status_code
        == 422
    )
    for source_id, name in zip(sources, ["Test Berlin", "TEST BERLIN"]):
        assert (
            admin.put(
                f"/api/sources/{source_id}/metadata", json={"tags": [name]}
            ).status_code
            == 200
        )
    catalog = admin.get("/api/sources").json()
    for source_id in sources:
        source = next(s for s in catalog if s["id"] == source_id)
        assert source["tag_styles"][source["tags"][0]] == {
            "color": "blue",
            "category": "location",
        }
    update = admin.put(
        "/api/catalog/tags",
        json={
            "name": "test berlin",
            "color": "purple",
            "category": "function",
            "version": tag["version"],
        },
    )
    assert update.status_code == 200
    assert (
        admin.put(
            "/api/catalog/tags",
            json={"name": "Test Berlin", "color": "red", "version": tag["version"]},
        ).status_code
        == 409
    )
    assert (
        admin.delete(
            f"/api/catalog/tags/{tag['key']}?version={tag['version']}"
        ).status_code
        == 409
    )
    assert (
        admin.delete(
            f"/api/catalog/tags/{tag['key']}?version={update.json()['version']}"
        ).status_code
        == 200
    )
    for source in admin.get("/api/sources").json():
        if source["id"] in sources:
            assert source["tags"] and source["tag_styles"] == {}


def test_bulk_preserves_owners_and_rolls_back_limits(admin, sources):
    for source_id in sources:
        assert (
            admin.put(
                f"/api/sources/{source_id}/metadata",
                json={
                    "tags": ["Existing"],
                    "owner": "Data Team",
                    "owner_email": "team@example.invalid",
                },
            ).status_code
            == 200
        )
    assert admin.post(
        "/api/catalog/tags/assign",
        json={"source_ids": sources, "tags": ["Berlin", "berlin", "ERP"]},
    ).json() == {"updated": 2}
    with Session() as db:
        for source_id in sources:
            metadata = db.get(SourceMetadata, source_id)
            assert metadata.tags == ["Existing", "Berlin", "ERP"]
            assert (
                metadata.owner == "Data Team"
                and metadata.owner_email == "team@example.invalid"
            )
    assert (
        admin.put(
            f"/api/sources/{sources[1]}/metadata",
            json={"tags": [f"tag{i}" for i in range(20)]},
        ).status_code
        == 200
    )
    assert (
        admin.post(
            "/api/catalog/tags/assign",
            json={"source_ids": sources, "tags": ["Overflow"]},
        ).status_code
        == 422
    )
    with Session() as db:
        assert "Overflow" not in db.get(SourceMetadata, sources[0]).tags
    assert (
        admin.post(
            "/api/catalog/tags/assign",
            json={"source_ids": sources, "tags": ["BERLIN"], "mode": "remove"},
        ).status_code
        == 200
    )
    with Session() as db:
        assert db.get(SourceMetadata, sources[0]).tags == ["Existing", "ERP"]
    assert (
        admin.post(
            "/api/catalog/tags/assign", json={"source_ids": [], "tags": ["tag"]}
        ).status_code
        == 422
    )


def test_grants_csrf_and_no_private_tag_discovery(admin, sources):
    result = admin.post(
        "/api/users",
        json={
            "username": "classification-editor",
            "display_name": "Editor",
            "password": "classification-password-123",
            "role": "editor",
        },
    )
    assert result.status_code == 200, result.text
    user_id = result.json()["id"]
    assert (
        admin.put(
            f"/api/sources/{sources[0]}/grants",
            json={"user_id": user_id, "edit": True, "data": False},
        ).status_code
        == 200
    )
    with TestClient(app) as editor:
        login = editor.post(
            "/api/auth/login",
            json={
                "username": "classification-editor",
                "password": "classification-password-123",
            },
        )
        editor.headers["x-csrf-token"] = login.json()["csrf"]
        assert (
            editor.put(
                "/api/catalog/tags", json={"name": "Private", "color": "red"}
            ).status_code
            == 403
        )
        assert (
            editor.post(
                "/api/catalog/tags/assign",
                json={"source_ids": sources, "tags": ["NoPartialChanges"]},
            ).status_code
            == 403
        )
        with Session() as db:
            assert db.get(SourceMetadata, sources[0]) is None
        assert (
            editor.post(
                "/api/catalog/tags/assign",
                json={"source_ids": [sources[0]], "tags": ["Granted"]},
            ).status_code
            == 200
        )
        assert (
            admin.put(
                f"/api/sources/{sources[1]}/metadata",
                json={"tags": ["Private undisclosed label"]},
            ).status_code
            == 200
        )
        assert "Private undisclosed label" not in str(
            editor.get("/api/catalog/tags").json()
        )
        assert (
            editor.post(
                "/api/catalog/tags/assign",
                json={"source_ids": [sources[0]], "tags": ["NoCsrf"]},
                headers={"x-csrf-token": "wrong"},
            ).status_code
            == 403
        )
        assert (
            editor.post(
                "/api/catalog/tags/assign",
                json={"source_ids": [sources[0]], "tags": ["ForeignOrigin"]},
                headers={"Origin": "https://evil.invalid"},
            ).status_code
            == 403
        )
    with TestClient(app) as anonymous:
        assert anonymous.get("/api/catalog/tags").status_code == 401
        assert (
            anonymous.post(
                "/api/catalog/tags/assign",
                json={"source_ids": sources, "tags": ["NoAuth"]},
            ).status_code
            == 401
        )
