"""Opt-in checks against dedicated disposable database containers only."""

import json
import os
import time

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL
from pymongo import MongoClient

from app.connectors import scan
from app.data_profiles import read_rows, summarize
from app.models import now

pytestmark = pytest.mark.skipif(
    os.getenv("ANALYSIS_CONNECTOR_INTEGRATION") != "1",
    reason="Requires dedicated disposable analysis containers",
)


@pytest.mark.parametrize("kind", ["postgresql", "mysql", "mariadb", "mssql", "mongodb"])
def test_catalog_and_bounded_profiles(kind):
    host = "databasedoc-analysis-" + (
        "postgres" if kind == "postgresql" else "mongo" if kind == "mongodb" else kind
    )
    cfg = {"host": host, "database": "analysis_fixture", "tls": False}
    if kind == "mongodb":
        client = MongoClient(host, serverSelectionTimeoutMS=2000)
        client.admin.command("ping")
        db = client[cfg["database"]]
        db.orders.drop()
        db.orders.insert_many(
            [{"nested": {"code": "RAW_SECRET_VALUE"}, "amount": n} for n in [10, 20]]
        )
        payload = scan(kind, cfg, infer=True)
        table = next(t for t in payload["tables"] if t["name"] == "orders")
        rows = read_rows(kind, cfg, table, ["nested.code", "amount"], 100)
        assert rows == [["RAW_SECRET_VALUE", 10], ["RAW_SECRET_VALUE", 20]]
        client.close()
    else:
        cfg.update(
            username=(
                "sa"
                if kind == "mssql"
                else "postgres" if kind == "postgresql" else "root"
            ),
            password=(
                "Analysis-connector-test-123!"
                if kind == "mssql"
                else "analysis-connector-password"
            ),
        )
        driver = {
            "postgresql": "postgresql+psycopg",
            "mysql": "mysql+pymysql",
            "mariadb": "mysql+pymysql",
            "mssql": "mssql+pyodbc",
        }[kind]
        query = (
            {"driver": "ODBC Driver 18 for SQL Server", "Encrypt": "no"}
            if kind == "mssql"
            else {}
        )
        base = (
            "master"
            if kind == "mssql"
            else "postgres" if kind == "postgresql" else "mysql"
        )
        url = URL.create(
            driver,
            username=cfg["username"],
            password=cfg["password"],
            host=host,
            database=base,
            query=query,
        )
        engine = create_engine(url, isolation_level="AUTOCOMMIT")
        for attempt in range(30):
            try:
                with engine.connect() as conn:
                    conn.execute(text("SELECT 1"))
                break
            except Exception:
                if attempt == 29:
                    raise
                time.sleep(1)
        if kind == "postgresql":
            cfg["database"] = "postgres"
        else:
            with engine.connect() as conn:
                if kind == "mssql":
                    conn.execute(
                        text(
                            "IF DB_ID('analysis_fixture') IS NULL CREATE DATABASE analysis_fixture"
                        )
                    )
                else:
                    conn.execute(text("CREATE DATABASE IF NOT EXISTS analysis_fixture"))
        engine.dispose()
        engine = create_engine(url.set(database=cfg["database"]))
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE TABLE analysis_parents(id INTEGER PRIMARY KEY, label VARCHAR(50))"
                )
            )
            conn.execute(
                text(
                    "CREATE TABLE analysis_children(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES analysis_parents(id))"
                )
            )
            conn.execute(
                text("INSERT INTO analysis_parents VALUES(1,'RAW_SECRET_VALUE')")
            )
            if kind == "postgresql":
                conn.execute(text("ANALYZE analysis_parents"))
        with engine.begin() as conn:
            conn.execute(
                text("CREATE VIEW analysis_view AS SELECT id FROM analysis_parents")
            )
        payload = scan(kind, cfg)
        assert not payload.get("warnings"), payload.get("warnings")
        table = next(t for t in payload["tables"] if t["name"] == "analysis_parents")
        assert table["estimated_rows"] is not None and table["estimated_rows"] >= 0
        view = next(t for t in payload["tables"] if t["name"] == "analysis_view")
        if kind in {"postgresql", "mysql", "mssql"}:
            assert any(
                d["name"] == "analysis_parents" for d in view["dependencies"]
            ), view
        else:
            assert view["dependency_status"] == "unavailable"
        rows = read_rows(kind, cfg, table, ["id", "label"], 100)
        assert rows == [[1, "RAW_SECRET_VALUE"]]
        engine.dispose()
    columns = ["nested.code", "amount"] if kind == "mongodb" else ["id", "label"]
    profile = summarize(rows, table, columns, 100, now())
    assert profile["complete_read"] and profile["row_count"] == len(rows)
    assert "RAW_SECRET_VALUE" not in json.dumps(profile)
