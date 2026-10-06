"""Opt-in tests against dedicated disposable database containers, never live databases."""

import os
import time
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL
from pymongo import MongoClient
from app.connectors import scan, preview, discover_databases, connection_test

pytestmark = pytest.mark.skipif(
    os.getenv("CONNECTOR_INTEGRATION") != "1",
    reason="Dedicated connector fixtures not enabled",
)


@pytest.mark.parametrize(
    "kind,host,driver,database,username",
    [
        (
            "postgresql",
            "datatlas-test-postgres",
            "postgresql+psycopg",
            "postgres",
            "postgres",
        ),
        ("mysql", "datatlas-test-mysql", "mysql+pymysql", "fixture", "root"),
        ("mariadb", "mariadb", "mysql+pymysql", "datatlas_connector_fixture", "root"),
    ],
)
def test_relational_connectors(kind, host, driver, database, username):
    password = (
        os.environ["MARIADB_ROOT_PASSWORD"]
        if kind == "mariadb"
        else "connector-test-password"
    )
    base = "mysql" if kind in {"mysql", "mariadb"} else "postgres"
    engine = create_engine(
        URL.create(
            driver, host=host, username=username, password=password, database=base
        )
    )
    for attempt in range(30):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            break
        except Exception:
            if attempt == 29:
                raise
            time.sleep(1)
    if kind in {"mysql", "mariadb"}:
        with engine.begin() as conn:
            conn.execute(text("CREATE DATABASE IF NOT EXISTS " + database))
        engine.dispose()
        engine = create_engine(
            URL.create(
                driver,
                host=host,
                username=username,
                password=password,
                database=database,
            )
        )
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS fixture_parents(id INTEGER PRIMARY KEY, label VARCHAR(50) NOT NULL)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS fixture_children(id INTEGER PRIMARY KEY, parent_id INTEGER, CONSTRAINT fk_fixture_parent FOREIGN KEY(parent_id) REFERENCES fixture_parents(id))"
            )
        )
        conn.execute(
            text("INSERT INTO fixture_parents(id,label) VALUES(1,'connector-fixture')")
        )
    cfg = {
        "host": host,
        "username": username,
        "password": password,
        "database": database,
        "tls": False,
    }
    connection_test(kind, cfg)
    assert database in discover_databases(kind, cfg)
    payload = scan(kind, cfg)
    tables = payload["tables"]
    parent = next(t for t in tables if t["name"] == "fixture_parents")
    child = next(t for t in tables if t["name"] == "fixture_children")
    assert child["foreign_keys"][0]["target_table"] == "fixture_parents"
    assert parent["primary_key"] == ["id"]
    assert preview(kind, cfg, parent)["rows"] == [[1, "connector-fixture"]]
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE fixture_children"))
        conn.execute(text("DROP TABLE fixture_parents"))
    engine.dispose()
    if kind == "mariadb":
        root = create_engine(
            URL.create(
                driver,
                host=host,
                username=username,
                password=password,
                database="mysql",
            )
        )
        with root.begin() as conn:
            conn.execute(text("DROP DATABASE datatlas_connector_fixture"))
        root.dispose()


def test_mongo_metadata_inference_preview_discovery():
    cfg = {"host": "datatlas-test-mongo", "database": "fixture", "tls": False}
    client = MongoClient(cfg["host"], serverSelectionTimeoutMS=10000)
    db = client.fixture
    db.orders.insert_many(
        [
            {"order_id": 1, "customer": {"name": "fixture"}, "items": [1, 2]},
            {"order_id": 2, "optional": True},
        ]
    )
    db.orders.create_index("order_id", unique=True)
    connection_test("mongodb", cfg)
    assert "fixture" in discover_databases("mongodb", cfg)
    metadata = scan("mongodb", cfg, infer=False)
    assert metadata["tables"][0]["columns"] == []
    assert metadata["tables"][0]["sampled_documents"] == 0
    inferred = scan("mongodb", cfg, infer=True)
    columns = inferred["tables"][0]["columns"]
    assert any(c["name"] == "customer.name" for c in columns)
    assert next(c for c in columns if c["name"] == "optional")["nullable"]
    assert inferred["tables"][0]["foreign_keys"] == []
    assert "fixture" not in str(columns)
    assert len(preview("mongodb", cfg, inferred["tables"][0])["rows"]) == 2
    client.drop_database("fixture")
    client.close()
