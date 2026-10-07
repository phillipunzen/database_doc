"""Private planning grants are independent of administrator/source privileges."""

import copy
import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, create_engine
from sqlalchemy.orm import Session as DBSession
from app.main import app, login_attempts
from app.models import Base, Session, User, Source, DatabaseDesign, DatabaseDesignGrant
from app.security import hasher
from app.design_tools import DesignInput, design_sql


def blueprint(kind="postgresql"):
    parent, child = str(uuid4()), str(uuid4())
    return {
        "name": "App <script> design",
        "description": "Private notes",
        "target_kind": kind,
        "database_name": "application_db",
        "target_schema": "app",
        "tables": [
            {
                "id": parent,
                "name": "customers",
                "columns": [
                    {
                        "name": "id",
                        "data_type": "bigint",
                        "primary_key": True,
                        "nullable": False,
                        "identity": True,
                    }
                ],
            },
            {
                "id": child,
                "name": "orders",
                "columns": [
                    {"name": "customer_id", "data_type": "bigint", "nullable": False}
                ],
                "relations": [
                    {
                        "columns": ["customer_id"],
                        "target_table_id": parent,
                        "target_columns": ["id"],
                    }
                ],
            },
        ],
    }


@pytest.fixture
def actors():
    login_attempts.clear()
    with TestClient(app) as startup:
        pass
    users = []
    with Session() as db:
        for role in ["editor", "viewer", "admin"]:
            user = User(
                username="tools_" + uuid4().hex,
                display_name=f"Design {role}",
                role=role,
                password_hash=hasher.hash("tools-user-password"),
            )
            db.add(user)
            db.flush()
            users.append(user)
        db.commit()
    clients = []
    for user in users:
        c = TestClient(app, headers={"Accept-Language": "en-US"})
        login = c.post(
            "/api/auth/login",
            json={"username": user.username, "password": "tools-user-password"},
        )
        assert login.status_code == 200
        c.headers["x-csrf-token"] = login.json()["csrf"]
        clients.append(c)
    yield users, clients
    for c in clients:
        c.close()
    with Session() as db:
        designs = list(
            db.scalars(
                select(DatabaseDesign).where(
                    DatabaseDesign.owner_id.in_([u.id for u in users])
                )
            )
        )
        for design in designs:
            db.query(DatabaseDesignGrant).filter_by(design_id=design.id).delete()
            db.delete(design)
        for u in users:
            db.query(DatabaseDesignGrant).filter_by(user_id=u.id).delete()
            from app.models import LoginSession

            db.query(LoginSession).filter_by(user_id=u.id).delete()
            db.delete(db.get(User, u.id))
        db.commit()


def payload(p):
    return {
        k: copy.deepcopy(p[k])
        for k in [
            "name",
            "description",
            "target_kind",
            "database_name",
            "target_schema",
            "tables",
            "version",
        ]
    }


def test_private_read_edit_share_revoke_and_owner_controls(actors):
    users, (owner, reader, other_admin) = actors
    result = owner.post("/api/tools/designs", json=blueprint())
    assert result.status_code == 200, result.text
    p = result.json()
    endpoint = f'/api/tools/designs/{p["id"]}'
    assert p["is_owner"] and p["can_edit"] and not p["shared"] and p["grants"] == []
    for c in (reader, other_admin):
        assert c.get("/api/tools/designs").json() == []
        for path in (
            endpoint,
            endpoint + "/users",
            endpoint + "/export",
            endpoint + "/export?format=json",
            endpoint + "/export?mode=drop",
        ):
            assert c.get(path).status_code == 404
        assert c.put(endpoint, json=payload(p)).status_code == 404
        assert c.delete(endpoint, params={"version": p["version"]}).status_code == 404
    directory = owner.get(endpoint + "/users", params={"q": users[1].username}).json()
    assert directory == [
        {
            "id": users[1].id,
            "display_name": users[1].display_name,
            "username": users[1].username,
        }
    ]
    p = owner.put(
        endpoint + "/sharing",
        json={"version": p["version"], "grants": [{"user_id": users[1].id}]},
    ).json()
    assert p["shared"] and p["version"] == 2
    shared = reader.get(endpoint).json()
    assert not shared["can_edit"] and "grants" not in shared
    assert reader.get("/api/tools/designs").json()[0]["id"] == p["id"]
    assert reader.get(endpoint + "/export").status_code == 200
    assert reader.put(endpoint, json=payload(p)).status_code == 404
    assert (
        reader.put(
            endpoint + "/sharing", json={"version": p["version"], "grants": []}
        ).status_code
        == 404
    )
    p = owner.put(
        endpoint + "/sharing",
        json={
            "version": p["version"],
            "grants": [{"user_id": users[1].id, "edit": True}],
        },
    ).json()
    body = payload(p)
    body["description"] = "Shared editor change"
    saved = reader.put(endpoint, json=body)
    assert saved.status_code == 200, saved.text
    p = owner.get(endpoint).json()
    assert p["description"] == "Shared editor change"
    assert reader.delete(endpoint, params={"version": p["version"]}).status_code == 404
    p = owner.put(
        endpoint + "/sharing", json={"version": p["version"], "grants": []}
    ).json()
    assert not p["shared"]
    for path in (endpoint, endpoint + "/export", endpoint + "/export?format=json"):
        assert reader.get(path).status_code == 404
    assert reader.put(endpoint, json=payload(p)).status_code == 404
    assert owner.delete(endpoint, params={"version": p["version"]}).status_code == 200
    with Session() as db:
        assert db.get(DatabaseDesign, p["id"]) is None
        assert not db.scalar(
            select(DatabaseDesignGrant).where(DatabaseDesignGrant.design_id == p["id"])
        )


def test_atomic_versioning_validation_inactive_users_csrf_and_viewer_ownership(actors):
    users, (owner, viewer, admin) = actors
    p = viewer.post("/api/tools/designs", json=blueprint()).json()
    assert p["can_edit"] and p["is_owner"]
    assert admin.get(f'/api/tools/designs/{p["id"]}').status_code == 404
    p = owner.post("/api/tools/designs", json=blueprint()).json()
    endpoint = f'/api/tools/designs/{p["id"]}'
    body = payload(p)
    saved = owner.put(endpoint, json=body).json()
    assert saved["version"] == 2
    assert owner.put(endpoint, json=body).status_code == 409
    assert (
        owner.put(
            endpoint + "/sharing",
            json={"version": 1, "grants": [{"user_id": users[1].id}]},
        ).status_code
        == 409
    )
    assert owner.delete(endpoint, params={"version": 1}).status_code == 409
    assert owner.get(endpoint).json()["grants"] == []
    for grants in (
        [{"user_id": users[0].id}],
        [{"user_id": users[1].id}, {"user_id": users[1].id}],
        [{"user_id": 999999}],
    ):
        assert (
            owner.put(
                endpoint + "/sharing", json={"version": 2, "grants": grants}
            ).status_code
            == 422
        )
    with Session() as db:
        db.get(User, users[1].id).active = False
        db.commit()
    assert (
        owner.put(
            endpoint + "/sharing",
            json={"version": 2, "grants": [{"user_id": users[1].id}]},
        ).status_code
        == 422
    )
    assert owner.get(endpoint + "/users", params={"q": users[1].username}).json() == []
    assert owner.get(endpoint).json()["version"] == 2
    assert (
        owner.put(
            endpoint, json=payload(saved), headers={"x-csrf-token": ""}
        ).status_code
        == 403
    )
    assert (
        owner.post(
            "/api/tools/designs", json=blueprint(), headers={"x-csrf-token": ""}
        ).status_code
        == 403
    )
    assert (
        owner.put(
            endpoint + "/sharing",
            json={"version": 2, "grants": []},
            headers={"x-csrf-token": ""},
        ).status_code
        == 403
    )
    for field, value in [
        ("owner_id", users[2].id),
        ("database_name", "x; DROP TABLE users;--"),
        ("target_schema", "bad name"),
    ]:
        invalid = payload(saved)
        invalid[field] = value
        assert owner.put(endpoint, json=invalid).status_code == 422
    invalid = payload(saved)
    invalid["tables"][1]["relations"][0]["target_columns"] = ["missing"]
    assert owner.put(endpoint, json=invalid).status_code == 422
    assert owner.get(endpoint).json()["version"] == 2


@pytest.mark.parametrize(
    "kind,quoted,identity",
    [
        ("mssql", "[application_db]", "IDENTITY"),
        ("postgresql", '"application_db"', "GENERATED BY DEFAULT AS IDENTITY"),
        ("mariadb", "`application_db`", "AUTO_INCREMENT"),
    ],
)
def test_separate_database_schema_and_drop_sql(kind, quoted, identity):
    body = DesignInput.model_validate(blueprint(kind))
    create = design_sql(body, "database")
    schema = design_sql(body, "schema")
    drop = design_sql(body, "drop")
    assert f"CREATE DATABASE {quoted}" in create and "CREATE TABLE" not in create
    assert identity in schema and "FOREIGN KEY" in schema and "DROP " not in schema
    assert schema.index("ALTER TABLE") > schema.rindex("CREATE TABLE")
    assert "Private notes" not in schema and "<script>" not in schema
    assert (
        f"DROP DATABASE {quoted};" in drop
        and "DESTRUCTIVE" in drop
        and "CREATE " not in drop
    )
    if kind == "mariadb":
        assert body.target_schema == body.database_name
    if kind == "postgresql":
        assert "USE " not in schema
    else:
        assert f"USE {quoted};" in schema


def test_exports_reject_empty_tables_and_persist_models(actors):
    users, (owner, reader, admin) = actors
    body = blueprint()
    body["tables"] = []
    p = owner.post("/api/tools/designs", json=body).json()
    endpoint = f'/api/tools/designs/{p["id"]}'
    assert owner.get(endpoint + "/export").status_code == 422
    assert owner.get(endpoint + "/export?mode=database").status_code == 200
    assert owner.get(endpoint + "/export?mode=invalid").status_code == 422
    assert owner.get(endpoint + "/export?format=invalid").status_code == 422
    exported = owner.get(endpoint + "/export?format=json")
    assert exported.json()["tables"] == []
    assert exported.headers["cache-control"] == "no-store"
    assert owner.get(endpoint).json()["name"] == body["name"]
    body = payload(p)
    body["tables"] = [{"name": "empty", "columns": []}]
    p = owner.put(endpoint, json=body).json()
    assert p["table_count"] == 1 and owner.get(endpoint + "/export").status_code == 422


def test_additive_tools_schema_preserves_existing_sources(tmp_path):
    engine = create_engine("sqlite:///" + str(tmp_path / "tools-migration.sqlite"))
    old = [
        t
        for t in Base.metadata.sorted_tables
        if not t.name.startswith("database_design")
    ]
    Base.metadata.create_all(engine, tables=old)
    with DBSession(engine) as db:
        db.add(
            Source(
                name="Existing", kind="sqlite", config_encrypted="preserve-ciphertext"
            )
        )
        db.commit()
    Base.metadata.create_all(engine)
    Base.metadata.create_all(engine)
    with DBSession(engine) as db:
        assert db.scalar(select(Source)).config_encrypted == "preserve-ciphertext"
        assert db.scalar(select(DatabaseDesign)) is None
