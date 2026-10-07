"""Central model integrity, adoption, version conflicts and grant isolation."""

import copy
import os
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.main import app, login_attempts
from app.models import Session, Snapshot, WarehouseWorkspace
from app.warehouse import ProjectInput


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


@pytest.fixture(scope="module")
def source(admin):
    path = Path(os.environ["SQLITE_ROOT"]) / "workspace.sqlite"
    path.touch()
    result = admin.post(
        "/api/sources",
        json={"name": "Workspace source", "kind": "sqlite", "path": str(path)},
    )
    assert result.status_code == 200
    source_id = result.json()["id"]
    with Session() as db:
        db.add(Snapshot(source_id=source_id, payload={"tables": [], "warnings": []}))
        db.commit()
    yield source_id
    assert admin.delete(f"/api/sources/{source_id}").status_code == 200


@pytest.fixture
def warehouse(admin, source):
    result = admin.post(
        "/api/dwh/warehouses",
        json={
            "name": "Central warehouse",
            "goal": "Sales and purchasing by day",
            "target_kind": "postgresql",
            "target_schema": "warehouse",
            "source_ids": [source],
        },
    )
    assert result.status_code == 200, result.text
    workspace = result.json()
    yield workspace
    current = admin.get(f'/api/dwh/warehouses/{workspace["id"]}').json()
    assert (
        admin.delete(
            f'/api/dwh/warehouses/{workspace["id"]}?version={current["project"]["version"]}'
        ).status_code
        == 200
    )
    project = admin.get(f'/api/dwh/projects/{workspace["project"]["id"]}').json()
    assert (
        admin.delete(
            f'/api/dwh/projects/{project["id"]}?version={project["version"]}'
        ).status_code
        == 200
    )


def metadata(admin, warehouse, areas=None, tasks=None, version=None):
    return admin.put(
        f'/api/dwh/warehouses/{warehouse["id"]}',
        json={
            "version": version or warehouse["project"]["version"],
            "areas": warehouse["areas"] if areas is None else areas,
            "tasks": warehouse["tasks"] if tasks is None else tasks,
        },
    )


def add_area(admin, warehouse, name):
    result = metadata(
        admin,
        warehouse,
        areas=warehouse["areas"]
        + [
            {
                "id": str(uuid4()),
                "name": name,
                "goal": "Daily business measures",
                "table_ids": [],
            }
        ],
    )
    assert result.status_code == 200, result.text
    return result.json()


def starter(admin, warehouse, area, name):
    result = admin.post(
        f'/api/dwh/warehouses/{warehouse["id"]}/starter',
        json={
            "version": warehouse["project"]["version"],
            "area_id": area["id"],
            "fact_name": name,
            "grain": "One row per order line",
            "measure_name": "net_amount",
            "measure_description": "Net amount in EUR, excluding tax",
        },
    )
    assert result.status_code == 200, result.text
    return result.json()


def model_body(warehouse):
    return {
        key: copy.deepcopy(warehouse["project"][key])
        for key in [
            "name",
            "goal",
            "target_kind",
            "target_schema",
            "target_source_id",
            "source_ids",
            "tables",
            "version",
        ]
    }


def test_shared_dimensions_are_single_definitions_and_export_once(admin, warehouse):
    warehouse = add_area(admin, warehouse, "Sales")
    warehouse = starter(admin, warehouse, warehouse["areas"][0], "fact_sales")
    warehouse = add_area(admin, warehouse, "Purchasing")
    warehouse = starter(admin, warehouse, warehouse["areas"][1], "fact_purchasing")
    tables = warehouse["project"]["tables"]
    assert len(tables) == 3
    calendar = next(table for table in tables if table["name"] == "dim_date")
    assert all(calendar["id"] in area["table_ids"] for area in warehouse["areas"])
    assert all(
        table["relations"][0]["target_table_id"] == calendar["id"]
        for table in tables
        if table["role"] == "fact"
    )
    model = model_body(warehouse)
    model["tables"][0]["description"] = "One central calendar definition"
    result = admin.put(
        f'/api/dwh/warehouses/{warehouse["id"]}/model', json={"project": model}
    )
    assert result.status_code == 200
    warehouse = result.json()
    sql = admin.get(
        f'/api/dwh/projects/{warehouse["project"]["id"]}/export?format=sql'
    ).text
    assert sql.count('CREATE TABLE warehouse."dim_date"') == 1
    assert sql.count('REFERENCES warehouse."dim_date"') == 2
    assert metadata(admin, warehouse, version=model["version"]).status_code == 409
    exported = admin.get(f'/api/dwh/warehouses/{warehouse["id"]}/export').json()
    assert exported["areas"] == warehouse["areas"]
    assert (
        exported["project"]["tables"][0]["description"]
        == "One central calendar definition"
    )
    assert admin.get(f'/api/dwh/warehouses/{warehouse["id"]}').json() == warehouse


def test_assignments_and_tasks_cannot_corrupt_or_delete_shared_model(admin, warehouse):
    warehouse = add_area(admin, warehouse, "Sales")
    warehouse = starter(admin, warehouse, warehouse["areas"][0], "fact_sales")
    model = model_body(warehouse)
    model["tables"] = []
    assert (
        admin.put(
            f'/api/dwh/projects/{warehouse["project"]["id"]}', json=model
        ).status_code
        == 409
    )
    assert (
        admin.delete(
            f'/api/dwh/projects/{warehouse["project"]["id"]}?version={model["version"]}'
        ).status_code
        == 409
    )
    broken = copy.deepcopy(warehouse["areas"])
    broken[0]["table_ids"].append(str(uuid4()))
    assert metadata(admin, warehouse, areas=broken).status_code == 422
    assert metadata(admin, warehouse, areas=warehouse["areas"] * 2).status_code == 422
    tasks = copy.deepcopy(warehouse["tasks"])
    tasks[0]["status"] = "done"
    assert metadata(admin, warehouse, tasks=tasks).status_code == 422
    tasks[0].update(
        notes="Reviewed SQL draft and validated row counts on 2026-10-07",
        owner="Data platform",
        due_date="2026-10-08",
        area_id=warehouse["areas"][0]["id"],
    )
    result = metadata(admin, warehouse, tasks=tasks)
    assert result.status_code == 200
    assert result.json()["tasks"][0]["status"] == "done"
    assert metadata(admin, warehouse, tasks=tasks).status_code == 409


def test_project_adoption_requires_explicit_matching_reuse_and_remaps_relations(
    admin, warehouse
):
    warehouse = add_area(admin, warehouse, "Sales")
    warehouse = starter(admin, warehouse, warehouse["areas"][0], "fact_sales")
    original = model_body(warehouse)
    original["name"] = "Purchasing project"
    original["version"] = None
    original["tables"][1]["name"] = "fact_purchasing"
    original_result = admin.post("/api/dwh/projects", json=original)
    assert original_result.status_code == 200
    project = original_result.json()
    try:
        body = {
            "project_id": project["id"],
            "source_version": project["version"],
            "version": warehouse["project"]["version"],
            "area_name": "Purchasing",
        }
        url = f'/api/dwh/warehouses/{warehouse["id"]}/adopt-project'
        result = admin.post(url, json=body)
        assert result.status_code == 422
        assert admin.get(f'/api/dwh/warehouses/{warehouse["id"]}').json() == warehouse
        calendar = warehouse["project"]["tables"][0]
        body["reuse"] = {project["tables"][0]["id"]: calendar["id"]}
        changed = copy.deepcopy(original)
        changed["version"] = project["version"]
        changed["tables"][0]["columns"][1]["purpose"] = "attribute"
        change = admin.put(f'/api/dwh/projects/{project["id"]}', json=changed)
        assert change.status_code == 200
        project = change.json()
        assert admin.post(url, json=body).status_code == 409
        body["source_version"] = project["version"]
        assert admin.post(url, json=body).status_code == 422
        changed["version"] = project["version"]
        changed["tables"][0]["columns"][1]["purpose"] = "business_key"
        change = admin.put(f'/api/dwh/projects/{project["id"]}', json=changed)
        assert change.status_code == 200
        project = change.json()
        body["source_version"] = project["version"]
        result = admin.post(url, json=body)
        assert result.status_code == 200, result.text
        merged = result.json()
        assert len(merged["project"]["tables"]) == 3
        fact = next(
            table
            for table in merged["project"]["tables"]
            if table["name"] == "fact_purchasing"
        )
        assert fact["id"] != project["tables"][1]["id"]
        assert fact["relations"][0]["target_table_id"] == calendar["id"]
        assert calendar["id"] in merged["areas"][1]["table_ids"]
        assert admin.get(f'/api/dwh/projects/{project["id"]}').json() == project
        assert admin.post(url, json=body).status_code == 409
        body["version"] = merged["project"]["version"]
        assert admin.post(url, json=body).status_code == 422
    finally:
        assert (
            admin.delete(
                f'/api/dwh/projects/{project["id"]}?version={project["version"]}'
            ).status_code
            == 200
        )


def test_conversion_keeps_existing_project_and_rejects_double_link(admin, source):
    created = admin.post(
        "/api/dwh/projects",
        json={
            "name": "Legacy plan",
            "target_kind": "mariadb",
            "target_schema": "warehouse",
            "source_ids": [source],
        },
    ).json()
    body = {"project_id": created["id"], "version": created["version"]}
    result = admin.post("/api/dwh/warehouses/from-project", json=body)
    assert result.status_code == 200
    warehouse = result.json()
    try:
        assert warehouse["project"]["id"] == created["id"]
        assert warehouse["project"]["version"] == created["version"]
        assert (
            admin.post("/api/dwh/warehouses/from-project", json=body).status_code == 409
        )
        assert any(
            item["id"] == warehouse["id"]
            for item in admin.get("/api/dwh/warehouses").json()
        )
    finally:
        with Session() as db:
            db.execute(
                delete(WarehouseWorkspace).where(
                    WarehouseWorkspace.id == warehouse["id"]
                )
            )
            db.commit()
        assert (
            admin.delete(
                f'/api/dwh/projects/{created["id"]}?version={created["version"]}'
            ).status_code
            == 200
        )


def test_workspace_requires_all_source_grants_and_csrf(admin, warehouse, source):
    anonymous = TestClient(app)
    root = f'/api/dwh/warehouses/{warehouse["id"]}'
    assert anonymous.get(root).status_code == 401
    assert anonymous.get(root + "/export").status_code == 401
    assert anonymous.delete(root + "?version=1").status_code == 401
    assert (
        admin.put(
            root,
            json={"version": 1, "areas": [], "tasks": []},
            headers={"x-csrf-token": ""},
        ).status_code
        == 403
    )
    assert (
        admin.put(
            root,
            json={"version": 1, "areas": [], "tasks": []},
            headers={"origin": "https://evil.invalid"},
        ).status_code
        == 403
    )
    login_attempts.clear()
    for role in ["viewer", "editor"]:
        result = admin.post(
            "/api/users",
            json={
                "username": "workspace-" + role,
                "display_name": "Workspace test",
                "password": "workspace-test-password",
                "role": role,
            },
        )
        assert result.status_code == 200
        user = result.json()
        with TestClient(app) as reader:
            login = reader.post(
                "/api/auth/login",
                json={
                    "username": user["username"],
                    "password": "workspace-test-password",
                },
            ).json()
            reader.headers["x-csrf-token"] = login["csrf"]
            assert reader.get(root).status_code == 404
            admin.put(
                f"/api/sources/{source}/grants",
                json={"user_id": user["id"], "edit": role == "editor"},
            )
            assert reader.get(root).status_code == 200
            assert reader.get(root + "/export").status_code == 200
            current = reader.get(root).json()
            result = metadata(reader, current)
            assert result.status_code == (200 if role == "editor" else 404)
            assert reader.delete(root + "?version=0").status_code == (
                409 if role == "editor" else 404
            )
            admin.delete(f'/api/sources/{source}/grants/{user["id"]}')
            assert reader.get(root).status_code == 404
            assert reader.get(root + "/export").status_code == 404
            assert reader.get("/api/dwh/warehouses").json() == []


def test_central_capacity_supports_sixty_sources_and_rejects_invalid_starter(
    admin, warehouse
):
    assert (
        len(
            ProjectInput(
                name="Large warehouse",
                target_kind="postgresql",
                target_schema="warehouse",
                source_ids=list(range(1, 61)),
            ).source_ids
        )
        == 60
    )
    warehouse = add_area(admin, warehouse, "Sales")
    body = {
        "version": warehouse["project"]["version"],
        "area_id": warehouse["areas"][0]["id"],
        "fact_name": "bad-name",
        "grain": "One row per sale",
        "measure_name": "amount",
        "measure_description": "EUR",
    }
    result = admin.post(f'/api/dwh/warehouses/{warehouse["id"]}/starter', json=body)
    assert result.status_code == 422
    assert admin.get(f'/api/dwh/warehouses/{warehouse["id"]}').json() == warehouse
