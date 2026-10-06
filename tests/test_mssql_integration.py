import os
import time
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL
from app.connectors import scan, preview, discover_databases, connection_test

pytestmark = pytest.mark.skipif(
    os.getenv("MSSQL_INTEGRATION") != "1",
    reason="Dedicated SQL Server fixture not enabled",
)


def test_mssql_connection_reflection_preview_and_discovery():
    host = "datatlas-test-mssql"
    password = "Connector_test_password_123!"
    query = {
        "driver": "ODBC Driver 18 for SQL Server",
        "Encrypt": "no",
        "TrustServerCertificate": "no",
    }
    root = create_engine(
        URL.create(
            "mssql+pyodbc",
            host=host,
            username="sa",
            password=password,
            database="master",
            query=query,
        ),
        isolation_level="AUTOCOMMIT",
        connect_args={"timeout": 5},
    )
    for attempt in range(20):
        try:
            with root.connect() as conn:
                conn.execute(text("SELECT 1"))
            break
        except Exception:
            if attempt == 19:
                raise
            time.sleep(1)
    with root.connect() as conn:
        conn.execute(text("CREATE DATABASE datatlas_mssql_fixture"))
    engine = create_engine(
        URL.create(
            "mssql+pyodbc",
            host=host,
            username="sa",
            password=password,
            database="datatlas_mssql_fixture",
            query=query,
        )
    )
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE parents(id INT PRIMARY KEY, label NVARCHAR(50) NOT NULL)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE children(id INT PRIMARY KEY, parent_id INT REFERENCES parents(id))"
            )
        )
        conn.execute(text("INSERT INTO parents VALUES (1,'connector-fixture')"))
    with engine.begin() as conn:
        conn.execute(text("CREATE VIEW parent_names AS SELECT label FROM dbo.parents"))
    cfg = {
        "host": host,
        "username": "sa",
        "password": password,
        "database": "datatlas_mssql_fixture",
        "schema": "dbo",
        "tls": False,
    }
    connection_test("mssql", cfg)
    assert "datatlas_mssql_fixture" in discover_databases("mssql", cfg)
    payload = scan("mssql", cfg)
    tables = payload["tables"]
    assert len(tables) == 3
    parent = next(t for t in tables if t["name"] == "parents")
    child = next(t for t in tables if t["name"] == "children")
    assert child["foreign_keys"][0]["target_table"] == "parents"
    assert parent["primary_key"] == ["id"]
    assert preview("mssql", cfg, parent)["rows"] == [[1, "connector-fixture"]]
    engine.dispose()
    with root.connect() as conn:
        conn.execute(text("DROP DATABASE datatlas_mssql_fixture"))
    root.dispose()
