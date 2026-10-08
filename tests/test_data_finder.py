"""Real targeted SQLite searches, semantic suggestions and permission boundaries."""

import os, json, sqlite3, hashlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, MagicMock
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, delete
from app.main import app
from app.models import (
    Session,
    Source,
    Snapshot,
    Grant,
    User,
    Note,
    Audit,
    BusinessConcept,
)
from app.security import encrypt, hasher
from app.connectors import scan, table_key
from app import finder_api, value_finder


@pytest.fixture(scope="module")
def fixture():
    with TestClient(app) as admin:
        login = admin.post(
            "/api/auth/login",
            json={"username": "admin", "password": os.environ["ADMIN_PASSWORD"]},
        )
        admin.headers["x-csrf-token"] = login.json()["csrf"]
        path = Path(os.environ["SQLITE_ROOT"]) / "finder.sqlite"
        with sqlite3.connect(path) as conn:
            conn.executescript(
                "CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE addresses(id INTEGER PRIMARY KEY,customer_id INTEGER REFERENCES customers(id),street TEXT,city TEXT); CREATE TABLE t101(f001 TEXT);"
            )
            conn.executemany(
                "INSERT INTO addresses VALUES(?,?,?,?)",
                [
                    (n, None, "Other road " + str(n), "Test city")
                    for n in range(1, 2001)
                ],
            )
            conn.execute(
                "INSERT INTO addresses VALUES(2001,NULL,?,?)",
                ("Musterstraße 33", "Literal_100%[x]"),
            )
            conn.execute("INSERT INTO t101 VALUES(?)", ("Confirmed concept value",))
        payload = scan("sqlite", {"path": str(path)})
        with Session() as db:
            sources = []
            for name in ["Finder ERP", "Finder CRM", "Hidden finder source"]:
                s = Source(
                    name=name,
                    kind="sqlite",
                    config_encrypted=encrypt(
                        {"path": str(path), "password": "FAKE_SECRET_PASSWORD"}
                    ),
                )
                db.add(s)
                db.flush()
                db.add(Snapshot(source_id=s.id, payload=payload))
                sources.append(s.id)
            reader = User(
                username="finder-reader",
                display_name="Finder reader",
                role="viewer",
                password_hash=hasher.hash("finder-reader-password"),
            )
            db.add(reader)
            db.flush()
            db.add(Grant(source_id=sources[0], user_id=reader.id, data=False))
            db.add(
                BusinessConcept(
                    content={
                        "name": "Kundenadressen",
                        "definition": "Customer postal addresses",
                        "owner": "Fixture owner",
                        "leading_binding": 0,
                        "bindings": [
                            {
                                "source_id": sources[0],
                                "table_key": table_key("", "t101"),
                                "column": "f001",
                                "table_name": "t101",
                                "snapshot_id": 1,
                                "data_type": "TEXT",
                                "transformation": "",
                            }
                        ],
                    }
                )
            )
            db.commit()
            uid = reader.id
        viewer = TestClient(app)
        login = viewer.post(
            "/api/auth/login",
            json={"username": "finder-reader", "password": "finder-reader-password"},
        )
        viewer.headers["x-csrf-token"] = login.json()["csrf"]
        yield SimpleNamespace(
            admin=admin, viewer=viewer, ids=sources, uid=uid, path=path, payload=payload
        )
        viewer.close()


def target(c, columns=["street"]):
    with Session() as db:
        snap = db.scalar(
            select(Snapshot)
            .where(Snapshot.source_id == c.ids[0])
            .order_by(Snapshot.id.desc())
        )
        return {
            "source_id": c.ids[0],
            "snapshot_id": snap.id,
            "table_key": table_key("", "addresses"),
            "columns": columns,
        }


def test_synonyms_relations_and_confirmed_concepts_use_metadata_only(
    fixture, monkeypatch
):
    c = fixture
    monkeypatch.setattr(
        finder_api,
        "search_targets",
        Mock(side_effect=AssertionError("No value reads during suggestions")),
    )
    for query in [
        "Wo finde ich die Adressen der Kunden?",
        "customer addresses",
        "Kundenadressen",
    ]:
        r = c.viewer.post("/api/finder/candidates", json={"query": query}).json()
        assert r["recognized_terms"] and all(
            t["source_id"] == c.ids[0] for t in r["candidates"]
        )
        a = next(t for t in r["candidates"] if t["table_name"] == "addresses")
        assert "street" in a["default_columns"] and not a["can_data"]
        t = next(t for t in r["candidates"] if t["table_name"] == "t101")
        assert t["concepts"] == ["Kundenadressen"] and t["default_columns"] == ["f001"]
        assert "FAKE_SECRET_PASSWORD" not in json.dumps(r)
    r = c.viewer.post(
        "/api/finder/candidates", json={"value_hint": "Musterstraße 33", "page_size": 1}
    ).json()
    assert r["recognized_terms"] and len(r["candidates"]) == 1 and r["total"] > 1
    assert (
        c.viewer.post(
            "/api/finder/candidates",
            json={"query": "customer addresses", "source_ids": [c.ids[2]]},
        ).json()["total"]
        == 0
    )
    assert (
        c.viewer.post("/api/finder/candidates", json={"query": ""}).status_code == 422
    )


def test_explicit_values_permissions_csrf_and_real_query_beyond_first_rows(fixture):
    c = fixture
    payload = {"value": "Musterstraße 33", "targets": [target(c)]}
    assert c.viewer.post("/api/finder/values", json=payload).status_code == 403
    saved = c.admin.headers.pop("x-csrf-token")
    assert c.admin.post("/api/finder/values", json=payload).status_code == 403
    c.admin.headers["x-csrf-token"] = saved
    assert (
        c.admin.post(
            "/api/finder/values",
            json=payload,
            headers={"Origin": "https://untrusted.invalid"},
        ).status_code
        == 403
    )
    before = hashlib.sha256(c.path.read_bytes()).digest()
    r = c.admin.post("/api/finder/values", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert (
        data["found_columns"] == 1
        and data["results"][0]["columns"][0]["status"] == "found"
    )
    assert "Musterstraße" not in r.text
    for mode, value, found in [
        ("contains", "Literal_100%[x]", True),
        ("contains", "Literal_100%[a-z]", False),
        ("exact", "'; DROP TABLE addresses; --", False),
    ]:
        response = c.admin.post(
            "/api/finder/values",
            json={"value": value, "mode": mode, "targets": [target(c, ["city"])]},
        )
        assert (
            response.status_code == 200
            and bool(response.json()["found_columns"]) == found
        )
    assert hashlib.sha256(c.path.read_bytes()).digest() == before
    with Session() as db:
        logs = db.scalars(
            select(Audit).where(Audit.action == "finder_value_search")
        ).all()
        assert logs and all(
            "Musterstraße" not in a.target and "DROP" not in a.target for a in logs
        )
        grant = db.scalar(
            select(Grant).where(Grant.source_id == c.ids[0], Grant.user_id == c.uid)
        )
        grant.data = True
        db.commit()
    try:
        assert (
            c.viewer.post("/api/finder/values", json=payload).json()["found_columns"]
            == 1
        )
    finally:
        with Session() as db:
            grant = db.scalar(
                select(Grant).where(Grant.source_id == c.ids[0], Grant.user_id == c.uid)
            )
            grant.data = False
            db.commit()


def test_invalid_targets_and_stale_scans_are_rejected(fixture):
    c = fixture
    t = target(c)
    for bad in [
        {**t, "columns": ["id"]},
        {**t, "columns": ["street", "street"]},
        {**t, "columns": ["street;DROP TABLE addresses"]},
        {**t, "table_key": "bad"},
    ]:
        assert c.admin.post(
            "/api/finder/values", json={"value": "street", "targets": [bad]}
        ).status_code in [422, 404]
    assert (
        c.admin.post(
            "/api/finder/values", json={"value": "street", "targets": [t, t]}
        ).status_code
        == 422
    )
    assert (
        c.admin.post(
            "/api/finder/values",
            json={"value": "street", "targets": [{**t, "snapshot_id": -1}]},
        ).status_code
        == 409
    )


def test_permission_revocation_discards_completed_results(fixture, monkeypatch):
    c = fixture
    with Session() as db:
        g = db.scalar(
            select(Grant).where(Grant.source_id == c.ids[0], Grant.user_id == c.uid)
        )
        g.data = True
        db.commit()

    def revoke(*args):
        with Session() as db:
            g = db.scalar(
                select(Grant).where(Grant.source_id == c.ids[0], Grant.user_id == c.uid)
            )
            g.data = False
            db.commit()
        return [{"source_id": c.ids[0], "columns": [{"status": "found"}]}]

    monkeypatch.setattr(finder_api, "search_targets", revoke)
    assert (
        c.viewer.post(
            "/api/finder/values",
            json={"value": "Musterstraße 33", "targets": [target(c)]},
        ).status_code
        == 403
    )


def test_budget_and_mongo_queries_never_return_raw_values(monkeypatch):
    ticks = iter([0, 46])
    monkeypatch.setattr(value_finder.time, "monotonic", lambda: next(ticks))
    result = value_finder.search_targets(
        [
            {
                "source_id": 1,
                "source_name": "Fixture",
                "kind": "sqlite",
                "cfg": {},
                "columns": ["street"],
                "table": {"key": "k", "name": "addresses"},
            }
        ],
        "secret",
        "exact",
        lambda: None,
    )
    assert result[0]["columns"][0]["status"] == "not_checked"
    db = MagicMock()
    db.__getitem__.return_value.aggregate.return_value = [{"found": 1}]
    assert value_finder.exists(
        "mongodb", db, {"name": "orders"}, "nested.street", "a.*[x]", "contains", 8
    )
    pipeline = db.__getitem__.return_value.aggregate.call_args.args[0]
    assert pipeline[0]["$match"]["nested.street"]["$regex"] == r"a\.\*\[x\]"
    assert pipeline[-1] == {"$project": {"_id": 0, "found": {"$literal": 1}}}
    assert db.__getitem__.return_value.aggregate.call_args.kwargs["maxTimeMS"] == 8000


def test_database_errors_are_unknown_and_limits_apply_before_queries(
    fixture, monkeypatch
):
    c = fixture
    body = {"value": "Musterstraße 33", "targets": [target(c)]}
    assert finder_api.slots.acquire(False)
    assert finder_api.slots.acquire(False)
    try:
        assert c.admin.post("/api/finder/values", json=body).status_code == 429
    finally:
        finder_api.slots.release()
        finder_api.slots.release()
    monkeypatch.setattr(
        value_finder,
        "exists",
        Mock(
            side_effect=RuntimeError("RAW_DRIVER_TEXT Musterstraße 33 password=SECRET")
        ),
    )
    result = c.admin.post("/api/finder/values", json=body)
    assert result.status_code == 200 and result.json()["incomplete"]
    assert result.json()["results"][0]["columns"][0]["status"] == "error"
    assert result.json()["checked_columns"] == 0 and result.json()["found_columns"] == 0
    assert all(
        secret not in result.text
        for secret in ["Musterstraße", "SECRET", "RAW_DRIVER_TEXT"]
    )


def test_business_question_classifies_customers_without_value_reads(
    fixture, monkeypatch
):
    c = fixture
    monkeypatch.setattr(
        finder_api,
        "search_targets",
        Mock(
            side_effect=AssertionError("Classification must only use stored metadata")
        ),
    )
    response = c.viewer.post(
        "/api/finder/candidates", json={"query": "Kundenauswertung"}
    )
    assert response.status_code == 200
    result = response.json()
    customer = next(
        table for table in result["candidates"] if table["table_name"] == "customers"
    )
    assert customer["suggested_role"] == "dimension"
    assert customer["inferred_categories"]
    assert all(table["source_id"] == c.ids[0] for table in result["candidates"])
