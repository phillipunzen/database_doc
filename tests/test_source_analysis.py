"""Analysis never reads source rows unless an authorized profile is requested."""

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.models import (
    Session,
    Source,
    Snapshot,
    Grant,
    User,
    SourceProfile,
    SourceAnalysis,
    BusinessConcept,
    now,
)
from app.security import encrypt, hasher
from app.connectors import scan, table_key
from app import analysis_api, catalog_analysis, connectors
from app.data_profiles import summarize, evaluate_rules, read_rows


@pytest.fixture(scope="module")
def catalog():
    with TestClient(app) as admin:
        login = admin.post(
            "/api/auth/login",
            json={"username": "admin", "password": os.environ["ADMIN_PASSWORD"]},
        )
        admin.headers["x-csrf-token"] = login.json()["csrf"]
        path = Path(os.environ["SQLITE_ROOT"]) / "analysis.sqlite"
        with sqlite3.connect(path) as conn:
            conn.executescript(
                "CREATE TABLE customers(id INTEGER PRIMARY KEY, customer_number TEXT, balance NUMERIC, updated_at DATETIME); CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id)); CREATE VIEW customer_view AS SELECT id FROM customers;"
            )
            conn.executemany(
                "INSERT INTO customers VALUES(?,?,?,?)",
                [
                    (1, "RAW_SECRET_VALUE", 10, "2020-01-01"),
                    (2, "RAW_SECRET_VALUE", 20, "2020-01-02"),
                    (3, None, -2, "2020-01-03"),
                    (4, "", None, None),
                ],
            )
        payload = scan("sqlite", {"path": str(path)})
        with Session() as db:
            sources = []
            for name in ["Analysis ERP", "Analysis CRM", "Hidden analysis system"]:
                source = Source(
                    name=name,
                    kind="sqlite",
                    config_encrypted=encrypt({"path": str(path)}),
                )
                db.add(source)
                db.flush()
                db.add(Snapshot(source_id=source.id, payload=payload))
                sources.append(source.id)
            viewer = User(
                username="analysis-reader",
                display_name="Analysis reader",
                role="viewer",
                password_hash=hasher.hash("analysis-reader-password"),
            )
            editor = User(
                username="analysis-editor",
                display_name="Analysis editor",
                role="editor",
                password_hash=hasher.hash("analysis-editor-password"),
            )
            db.add_all([viewer, editor])
            db.flush()
            db.add(Grant(source_id=sources[0], user_id=viewer.id, data=False))
            db.add(Grant(source_id=sources[0], user_id=editor.id, edit=True, data=True))
            db.commit()
            viewer_id, editor_id = viewer.id, editor.id
        reader = TestClient(app)
        editor_client = TestClient(app)
        for client, name in [(reader, "reader"), (editor_client, "editor")]:
            result = client.post(
                "/api/auth/login",
                json={
                    "username": "analysis-" + name,
                    "password": "analysis-" + name + "-password",
                },
            )
            client.headers["x-csrf-token"] = result.json()["csrf"]
        yield SimpleNamespace(
            admin=admin,
            reader=reader,
            editor=editor_client,
            ids=sources,
            viewer_id=viewer_id,
            editor_id=editor_id,
            path=path,
            key=table_key(None, "customers"),
        )
        reader.close()
        editor_client.close()


def test_metadata_analysis_and_preparation_permissions(catalog, monkeypatch):
    c = catalog
    url = f"/api/sources/{c.ids[0]}/analysis"
    monkeypatch.setattr(
        analysis_api,
        "read_rows",
        lambda *a: pytest.fail("metadata analysis must not read data"),
    )
    r = c.reader.get(url, headers={"Accept-Language": "en-US"})
    assert r.status_code == 200
    body = r.json()
    assert body["can_data"] is False
    assert body["counts"]["objects"] == 3
    assert "row meaning" in str(body).lower()
    assert "RAW_SECRET_VALUE" not in str(body)
    customers = next(t for t in body["tables"] if t["name"] == "customers")
    assert customers["change_candidates"] == ["updated_at"]
    assert customers["used_by"][0]["name"] == "orders"
    assert c.reader.get(f"/api/sources/{c.ids[2]}/analysis").status_code == 403
    prep = {
        "version": body["settings"]["version"],
        "table_key": c.key,
        "grain": "One row per customer",
        "load_mode": "full",
        "delete_strategy": "Compare full key set",
        "role": "dimension",
    }
    assert c.reader.put(url + "/preparation", json=prep).status_code == 403
    saved = c.editor.put(url + "/preparation", json=prep)
    assert saved.status_code == 200
    assert c.editor.put(url + "/preparation", json=prep).status_code == 409
    updated = c.admin.get(url).json()
    t = next(t for t in updated["tables"] if t["table_key"] == c.key)
    assert all(t["readiness"].values())
    assert not any(
        f["table_key"] == c.key and f["code"] == "change_missing"
        for f in updated["findings"]
    )
    bad = {
        **prep,
        "version": updated["settings"]["version"],
        "change_column": "nonexistent",
    }
    assert c.admin.put(url + "/preparation", json=bad).status_code == 422
    no_csrf = c.admin.put(url + "/preparation", json=bad, headers={"x-csrf-token": ""})
    assert no_csrf.status_code == 403


def test_explicit_profile_aggregates_rules_history_and_revocation(catalog):
    c = catalog
    url = f"/api/sources/{c.ids[0]}/analysis"
    config = c.admin.get(url).json()
    rules = [
        {
            "name": "Number unique",
            "table_key": c.key,
            "column": "customer_number",
            "kind": "unique",
        },
        {
            "name": "Number required",
            "table_key": c.key,
            "column": "customer_number",
            "kind": "not_empty",
        },
        {
            "name": "Balance bounds",
            "table_key": c.key,
            "column": "balance",
            "kind": "range",
            "minimum": 0,
            "maximum": 100,
        },
        {
            "name": "Data recent",
            "table_key": c.key,
            "column": "updated_at",
            "kind": "freshness",
            "max_age_hours": 24,
        },
    ]
    saved = c.admin.put(
        url + "/rules", json={"version": config["settings"]["version"], "rules": rules}
    )
    assert saved.status_code == 200
    config = c.admin.get(url).json()
    request = {
        "table_key": c.key,
        "snapshot_id": config["snapshot_id"],
        "settings_version": config["settings"]["version"],
        "columns": ["id", "customer_number", "balance", "updated_at"],
        "sample_limit": 100,
    }
    assert c.reader.post(url + "/profiles", json=request).status_code == 403
    response = c.editor.post(url + "/profiles", json=request)
    assert response.status_code == 200, response.text
    profile = response.json()["profile"]
    assert profile["row_count"] == 4 and profile["complete_read"] is True
    code = next(x for x in profile["columns"] if x["name"] == "customer_number")
    assert (
        code["null_count"] == 1
        and code["empty_count"] == 1
        and code["duplicate_non_null"] == 1
    )
    assert {r["status"] for r in profile["rules"]} == {"failed"}
    assert profile["keys"] == [{"columns": ["id"], "duplicates": 0, "null_rows": 0}]
    assert "RAW_SECRET_VALUE" not in json.dumps(profile)
    history = c.editor.get(url + "/profiles", params={"table_key": c.key}).json()
    assert history[0]["id"] == response.json()["id"]
    assert c.reader.get(url + "/profiles").status_code == 403
    with Session() as db:
        db.add(
            Snapshot(
                source_id=c.ids[0],
                payload=db.scalar(
                    select(Snapshot)
                    .where(Snapshot.source_id == c.ids[0])
                    .order_by(Snapshot.id.desc())
                ).payload,
            )
        )
        db.commit()
    assert c.editor.get(url + "/profiles").json()[0]["stale_schema"] is True
    assert c.editor.post(url + "/profiles", json=request).status_code == 409
    with Session() as db:
        grant = db.scalar(
            select(Grant).where(
                Grant.source_id == c.ids[0], Grant.user_id == c.editor_id
            )
        )
        grant.data = False
        db.commit()
    assert c.editor.get(url + "/profiles").status_code == 403
    assert c.editor.post(url + "/profiles", json=request).status_code == 403
    with Session() as db:
        grant = db.scalar(
            select(Grant).where(
                Grant.source_id == c.ids[0], Grant.user_id == c.editor_id
            )
        )
        grant.data = True
        db.commit()
    for invalid in [
        {**request, "columns": ["id; DROP TABLE customers"]},
        {**request, "columns": ["id", "id"]},
        {**request, "sample_limit": 5001},
    ]:
        invalid["snapshot_id"] = c.admin.get(url).json()["snapshot_id"]
        assert c.admin.post(url + "/profiles", json=invalid).status_code == 422
    with sqlite3.connect(c.path) as db:
        assert db.execute("SELECT count(*) FROM customers").fetchone()[0] == 4


def test_profile_race_does_not_publish_after_data_grant_is_revoked(
    catalog, monkeypatch
):
    c = catalog
    url = f"/api/sources/{c.ids[0]}/analysis"
    config = c.admin.get(url).json()
    before = c.admin.get(url + "/profiles").json()

    def revoke(*args):
        with Session() as db:
            g = db.scalar(
                select(Grant).where(
                    Grant.source_id == c.ids[0], Grant.user_id == c.editor_id
                )
            )
            g.data = False
            db.commit()
        return [[1]]

    monkeypatch.setattr(analysis_api, "read_rows", revoke)
    try:
        result = c.editor.post(
            url + "/profiles",
            json={
                "table_key": c.key,
                "snapshot_id": config["snapshot_id"],
                "settings_version": config["settings"]["version"],
                "columns": ["id"],
                "sample_limit": 100,
            },
        )
        assert result.status_code == 403
        assert c.admin.get(url + "/profiles").json() == before
    finally:
        with Session() as db:
            g = db.scalar(
                select(Grant).where(
                    Grant.source_id == c.ids[0], Grant.user_id == c.editor_id
                )
            )
            g.data = True
            db.commit()


def test_sample_rules_do_not_claim_full_uniqueness_or_global_freshness():
    table = {
        "columns": [
            {"name": "code", "type": "TEXT"},
            {"name": "updated_at", "type": "DATETIME"},
        ],
        "primary_key": [],
    }
    rows = [[str(i), "2020-01-01"] for i in range(101)]
    p = summarize(rows, table, ["code", "updated_at"], 100, now())
    assert p["complete_read"] is False and p["row_count"] == 100
    rules = [
        {
            "id": "a",
            "table_key": "t",
            "column": "code",
            "kind": "unique",
            "name": "Unique",
        },
        {
            "id": "b",
            "table_key": "t",
            "column": "updated_at",
            "kind": "freshness",
            "name": "Fresh",
            "max_age_hours": 24,
        },
    ]
    results = evaluate_rules(p, rules, "t", now())
    assert [r["status"] for r in results] == ["sample_passed", "inconclusive"]
    p = summarize([], table, ["code"], 100, now())
    assert evaluate_rules(p, rules, "t", now())[0]["status"] == "not_checked"


def test_global_business_bindings_permissions_versions_and_missing_fields(catalog):
    c = catalog
    body = {
        "name": "Customer identity",
        "definition": "Confirmed by the ERP and CRM teams",
        "leading_binding": 0,
        "bindings": [
            {
                "source_id": c.ids[0],
                "table_key": c.key,
                "column": "customer_number",
                "transformation": "CRM IDs require a translation table",
            },
            {"source_id": c.ids[1], "table_key": c.key, "column": "customer_number"},
        ],
    }
    reader = c.reader.get("/api/analysis/catalog").json()
    assert len([s for s in reader["sources"] if s["id"] in c.ids]) == 1
    assert all(
        b["source_id"] != c.ids[2] for s in reader["suggestions"] for b in s["bindings"]
    )
    assert c.reader.post("/api/analysis/concepts", json=body).status_code == 403
    assert c.editor.post("/api/analysis/concepts", json=body).status_code == 403
    created = c.admin.post("/api/analysis/concepts", json=body)
    assert created.status_code == 200, created.text
    item = created.json()
    id = item["id"]
    assert not any(
        x["id"] == id for x in c.reader.get("/api/analysis/catalog").json()["concepts"]
    )
    assert (
        c.reader.put(
            f"/api/analysis/concepts/{id}", json={**body, "version": 1}
        ).status_code
        == 404
    )
    assert (
        c.admin.put(
            f"/api/analysis/concepts/{id}", json={**body, "version": 99}
        ).status_code
        == 409
    )
    assert c.admin.delete(f"/api/sources/{c.ids[1]}").status_code == 409
    with Session() as db:
        old = db.scalar(
            select(Snapshot)
            .where(Snapshot.source_id == c.ids[0])
            .order_by(Snapshot.id.desc())
        )
        payload = json.loads(json.dumps(old.payload))
        target = next(t for t in payload["tables"] if t["key"] == c.key)
        next(col for col in target["columns"] if col["name"] == "customer_number")[
            "type"
        ] = "VARCHAR(200)"
        db.add(Snapshot(source_id=c.ids[0], payload=payload))
        db.commit()
    changed = c.admin.put(
        f"/api/analysis/concepts/{id}", json={**body, "version": 1}
    ).json()
    assert changed["bindings"][0]["state"] == "changed"
    assert changed["bindings"][0]["data_type"] != "VARCHAR(200)"
    body["bindings"][0]["confirm_current"] = True
    confirmed = c.admin.put(
        f"/api/analysis/concepts/{id}", json={**body, "version": changed["version"]}
    ).json()
    assert confirmed["bindings"][0]["state"] == "current"
    assert confirmed["bindings"][0]["data_type"] == "VARCHAR(200)"
    body["bindings"][0].pop("confirm_current")
    with Session() as db:
        old = db.scalar(
            select(Snapshot)
            .where(Snapshot.source_id == c.ids[1])
            .order_by(Snapshot.id.desc())
        )
        payload = json.loads(json.dumps(old.payload))
        payload["tables"] = [t for t in payload["tables"] if t["name"] != "customers"]
        db.add(Snapshot(source_id=c.ids[1], payload=payload))
        db.commit()
    item = next(
        x
        for x in c.admin.get("/api/analysis/catalog").json()["concepts"]
        if x["id"] == id
    )
    assert item["bindings"][1]["state"] == "missing"
    retained = c.admin.put(
        f"/api/analysis/concepts/{id}", json={**body, "version": confirmed["version"]}
    )
    assert retained.status_code == 200
    assert retained.json()["bindings"][1]["state"] == "missing"
    removed = c.admin.request(
        "DELETE",
        f"/api/analysis/concepts/{id}",
        json={"version": retained.json()["version"]},
    )
    assert removed.status_code == 200
    assert c.admin.delete(f"/api/sources/{c.ids[1]}").status_code == 200


def test_mongo_profile_projection_and_optional_catalog_failure(monkeypatch):
    db = MagicMock()
    cursor = MagicMock()
    cursor.limit.return_value = [{"nested": {"code": "SECRET"}, "value": None}]
    db.__getitem__.return_value.find.return_value = cursor

    @contextmanager
    def mongo(cfg):
        yield db

    monkeypatch.setattr(connectors, "mongo", mongo)
    result = read_rows("mongodb", {}, {"name": "orders"}, ["nested.code", "value"], 100)
    assert result == [["SECRET", None]]
    db.__getitem__.return_value.find.assert_called_once_with(
        {}, {"nested.code": 1, "value": 1, "_id": 0}, max_time_ms=15000
    )
    conn = MagicMock()
    conn.execute.side_effect = RuntimeError("SECRET CONNECTION DETAILS")
    t = {"key": table_key("dbo", "orders"), "name": "orders"}
    warnings = catalog_analysis.enrich("mssql", conn, [t])
    assert len(warnings) == 2 and "SECRET" not in str(warnings)
    assert t["dependency_status"] == "unavailable"


def test_numeric_equivalence_precision_and_text_collation_scope():
    from decimal import Decimal
    from bson.decimal128 import Decimal128
    from app.data_profiles import fingerprint

    assert fingerprint(1) == fingerprint(1.0) == fingerprint(Decimal128("1.00"))
    assert fingerprint(Decimal("123456789012345678901234567890.1")) != fingerprint(
        Decimal("123456789012345678901234567890.2")
    )
    assert fingerprint(True) != fingerprint(1)
    assert fingerprint("A") != fingerprint("a")
    table = {
        "columns": [{"name": "amount", "type": "Decimal128"}],
        "primary_key": ["amount"],
    }
    p = summarize([[1], [1.0], [Decimal128("1.00")]], table, ["amount"], 100, now())
    assert p["columns"][0]["distinct_non_null"] == 1
    assert p["columns"][0]["numeric_count"] == 3
    assert p["keys"][0]["duplicates"] == 2
