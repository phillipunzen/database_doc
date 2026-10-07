"""Opt-in existence queries against dedicated disposable database containers."""

import os
import time
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL
from pymongo import MongoClient
from app.connectors import scan
from app.value_finder import exists, search_connection

pytestmark = pytest.mark.skipif(
    os.getenv("FINDER_CONNECTOR_INTEGRATION") != "1",
    reason="Requires dedicated disposable finder containers",
)


@pytest.mark.parametrize("kind", ["postgresql", "mysql", "mariadb", "mssql", "mongodb"])
def test_parameterized_native_searches(kind):
    host = "databasedoc-finder-" + {"postgresql": "postgres", "mongodb": "mongo"}.get(
        kind, kind
    )
    cfg = {"host": host, "database": "finder_fixture", "tls": False}
    value = "Musterstraße 33_%[x]!"
    if kind == "mongodb":
        client = MongoClient(host, serverSelectionTimeoutMS=2000)
        client.admin.command("ping")
        db = client[cfg["database"]]
        db.addresses.drop()
        db.addresses.insert_one({"nested": {"street": value}})
        table = next(
            t for t in scan(kind, cfg, infer=True)["tables"] if t["name"] == "addresses"
        )
        column = "nested.street"
    else:
        cfg.update(
            username=(
                "sa"
                if kind == "mssql"
                else "postgres" if kind == "postgresql" else "root"
            ),
            password=(
                "Finder-fixture-test-123!"
                if kind == "mssql"
                else "finder-fixture-password"
            ),
        )
        driver = {
            "postgresql": "postgresql+psycopg",
            "mysql": "mysql+pymysql",
            "mariadb": "mysql+pymysql",
            "mssql": "mssql+pyodbc",
        }[kind]
        base = (
            "master"
            if kind == "mssql"
            else "postgres" if kind == "postgresql" else "mysql"
        )
        query = (
            {"driver": "ODBC Driver 18 for SQL Server", "Encrypt": "no"}
            if kind == "mssql"
            else {}
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
        for attempt in range(45):
            try:
                with engine.connect() as conn:
                    conn.execute(text("SELECT 1"))
                break
            except Exception:
                if attempt == 44:
                    raise
                time.sleep(1)
        if kind == "postgresql":
            cfg["database"] = "postgres"
        else:
            with engine.connect() as conn:
                conn.execute(
                    text(
                        "IF DB_ID('finder_fixture') IS NULL CREATE DATABASE finder_fixture"
                        if kind == "mssql"
                        else "CREATE DATABASE IF NOT EXISTS finder_fixture"
                    )
                )
        engine.dispose()
        engine = create_engine(url.set(database=cfg["database"]))
        quote = engine.dialect.identifier_preparer.quote
        column = "street name]"
        name = "finder addresses"
        qtable, qcolumn = quote(name), quote(column)
        dtype = "NVARCHAR(200)" if kind == "mssql" else "VARCHAR(200)"
        with engine.begin() as conn:
            conn.execute(text(f"CREATE TABLE {qtable} ({qcolumn} {dtype})"))
            conn.execute(
                text(f"INSERT INTO {qtable} VALUES (:value)"), {"value": value}
            )
            if kind == "mssql":
                conn.execute(text("CREATE TABLE finder_legacy (street NTEXT)"))
                conn.execute(
                    text("INSERT INTO finder_legacy VALUES (:value)"), {"value": value}
                )
        table = next(t for t in scan(kind, cfg)["tables"] if t["name"] == name)
    with search_connection(kind, cfg) as conn:
        assert exists(kind, conn, table, column, value, "exact", 8)
        assert exists(kind, conn, table, column, value, "contains", 8)
        assert not exists(kind, conn, table, column, "_%[y]!", "contains", 8)
        assert not exists(kind, conn, table, column, "' OR 1=1 --", "exact", 8)
        if kind == "mssql":
            assert exists(
                kind,
                conn,
                {
                    "name": "finder_legacy",
                    "schema": "dbo",
                    "columns": [{"name": "street", "type": "NTEXT"}],
                },
                "street",
                value,
                "exact",
                8,
            )
        if kind == "postgresql":
            assert conn.exec_driver_sql("SHOW statement_timeout").scalar() == "8s"
        if kind == "mariadb":
            assert conn.exec_driver_sql("SELECT @@max_statement_time").scalar() == 8
        if kind == "mysql":
            assert conn.exec_driver_sql("SELECT @@max_execution_time").scalar() == 8000
        if kind == "mssql":
            assert conn.connection.driver_connection.timeout == 8
    if kind == "mongodb":
        client.close()
    else:
        engine.dispose()
