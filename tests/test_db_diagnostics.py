"""Safe remote scan diagnosis with preserved searchable metadata and localization."""

import logging
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import pymysql
from sqlalchemy.exc import OperationalError
from sqlalchemy import Integer, select
from sqlalchemy.engine.default import DefaultDialect
from fastapi.testclient import TestClient
from app import connectors, jobs
from app.db_errors import diagnostic
from app.i18n import LANGUAGE, tr_message
from app.models import Session, Source, Job, Snapshot, SearchEntry
from app.security import encrypt
from app.main import app


@pytest.mark.parametrize(
    "code,fragment",
    [
        (1045, "Anmeldung"),
        (1142, "Zugriff verweigert"),
        (1356, "View"),
        (1449, "Datenbankbenutzer"),
        (1969, "Zeitüberschreitung"),
        (2013, "unterbrochen"),
        (2026, "TLS"),
        (1153, "max_allowed_packet"),
        (7777, "nicht eindeutig"),
    ],
)
def test_mysql_codes_are_actionable_without_driver_sql_or_credentials(code, fragment):
    error = OperationalError(
        "SELECT RAW_SECRET_VALUE",
        {"password": "SECRET_PASSWORD"},
        pymysql.err.OperationalError(
            code,
            "SECRET_PASSWORD private-host private-user private-db RAW_SECRET_VALUE",
        ),
    )
    message = diagnostic("mariadb", error, "columns")
    assert (
        f"MariaDB {code}" in message
        and "Spalten auslesen" in message
        and fragment in message
    )
    assert not any(
        s in message
        for s in [
            "SECRET_PASSWORD",
            "private-host",
            "private-user",
            "private-db",
            "RAW_SECRET_VALUE",
        ]
    )
    token = LANGUAGE.set("en")
    try:
        translated = tr_message(message)
        assert "Step: Read columns." in translated and "Schritt" not in translated
        assert diagnostic("mariadb", error, "columns") == translated
    finally:
        LANGUAGE.reset(token)


def test_sqlstate_is_taken_from_structured_fields_only():
    error = OperationalError(
        "SECRET_SQL", None, SimpleNamespace(sqlstate="42501", args=("SECRET_PASSWORD",))
    )
    assert "SQLSTATE 42501" in diagnostic("postgresql", error)
    error = OperationalError("SECRET_SQL", None, Exception("SECRET_PASSWORD"))
    assert "SECRET" not in diagnostic("mssql", error)
    error = OperationalError("SECRET_SQL", None, Exception("HYT00", "SECRET_PASSWORD"))
    assert "SQLSTATE HYT00" in diagnostic("mssql", error)


def test_scan_failure_stage_history_log_and_localized_api(monkeypatch, caplog):
    inspector = Mock()
    inspector.get_table_names.return_value = ["customers"]
    inspector.get_view_names.return_value = ["broken_view"]
    inspector.get_columns.return_value = [
        {"name": "id", "type": Integer(), "nullable": False}
    ]
    inspector.get_pk_constraint.return_value = {"constrained_columns": ["id"]}
    inspector.get_foreign_keys.return_value = []
    inspector.get_indexes.return_value = []
    inspector.get_unique_constraints.return_value = []
    inspector.get_table_comment.return_value = {"text": None}
    original = OperationalError(
        "SECRET_SQL",
        {"password": "SECRET_PASSWORD"},
        pymysql.err.OperationalError(1356, "SECRET_PASSWORD private-host"),
    )

    def columns(name, schema):
        if name == "broken_view":
            raise original
        return [{"name": "id", "type": Integer(), "nullable": False}]

    inspector.get_columns.side_effect = columns

    @contextmanager
    def connection(*args):
        yield SimpleNamespace(dialect=DefaultDialect())

    monkeypatch.setattr(connectors, "relational", connection)
    monkeypatch.setattr(connectors, "inspect", lambda conn: inspector)
    with TestClient(app) as client, Session() as db:
        source = Source(
            name="Diagnostic fixture",
            kind="mariadb",
            config_encrypted=encrypt(
                {
                    "host": "private-host",
                    "database": "fixture",
                    "password": "SECRET_PASSWORD",
                }
            ),
        )
        db.add(source)
        db.flush()
        snapshot = Snapshot(
            source_id=source.id,
            payload={
                "kind": "mariadb",
                "tables": [],
                "warnings": [],
                "inferred": False,
            },
        )
        db.add(snapshot)
        db.add(
            SearchEntry(
                source_id=source.id,
                kind="table",
                title="Existing search result",
                content="Existing text",
                table_key="old",
                table_name="old",
                column_name=None,
            )
        )
        job = Job(source_id=source.id)
        db.add(job)
        db.commit()
        sid, jid, snap_id = source.id, job.id, snapshot.id
        with caplog.at_level(logging.WARNING, logger="app.jobs"):
            jobs.run_scan(jid)
        db.expire_all()
        failed = db.get(Job, jid)
        assert (
            failed.status == "failed"
            and "MariaDB 1356" in failed.message
            and "Spalten auslesen" in failed.message
        )
        assert (
            db.scalars(select(Snapshot).where(Snapshot.source_id == sid)).all()[0].id
            == snap_id
        )
        assert (
            db.scalar(select(SearchEntry).where(SearchEntry.source_id == sid)).title
            == "Existing search result"
        )
        assert "MariaDB 1356" in caplog.text
        assert "SECRET" not in caplog.text and "private-host" not in caplog.text
        import os

        login = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": os.environ["ADMIN_PASSWORD"]},
        )
        client.headers["x-csrf-token"] = login.json()["csrf"]
        for language, expected in [("de", "Spalten auslesen"), ("en", "Read columns")]:
            response = client.get("/api/sources", headers={"Accept-Language": language})
            item = next(s for s in response.json() if s["id"] == sid)
            assert expected in item["job"]["message"]
        monkeypatch.setattr("app.main.connection_test", Mock(side_effect=original))
        response = client.post(
            f"/api/sources/{sid}/test", headers={"Accept-Language": "en"}
        )
        assert (
            response.status_code == 400
            and "MariaDB 1356" in response.json()["detail"]
            and "Step: Test connection" in response.json()["detail"]
        )


def test_failed_application_storage_is_distinguished_from_source(monkeypatch):
    with TestClient(app), Session() as db:
        source = Source(
            name="Storage failure fixture",
            kind="postgresql",
            config_encrypted=encrypt({}),
        )
        db.add(source)
        db.flush()
        job = Job(source_id=source.id)
        db.add(job)
        db.commit()
        jid = job.id
        sid = source.id
    monkeypatch.setattr(jobs, "scan", lambda *args: {"tables": []})
    monkeypatch.setattr(
        jobs,
        "reindex_source",
        Mock(
            side_effect=OperationalError(
                "SECRET_SQL",
                None,
                pymysql.err.OperationalError(1153, "SECRET_PASSWORD"),
            )
        ),
    )
    jobs.run_scan(jid)
    with Session() as db:
        job = db.get(Job, jid)
        assert (
            job.status == "failed"
            and "MariaDB 1153" in job.message
            and "Dokumentation speichern" in job.message
        )
        assert db.scalar(select(Snapshot).where(Snapshot.source_id == sid)) is None


@pytest.mark.skipif(
    __import__("os").getenv("DB_DIAGNOSTICS_INTEGRATION") != "1",
    reason="Requires dedicated disposable MariaDB container",
)
def test_real_mariadb_connection_succeeds_but_invalid_view_scan_fails():
    import time
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import URL

    cfg = {
        "host": "databasedoc-diagnostics-mariadb",
        "database": "diagnostics_fixture",
        "username": "root",
        "password": "diagnostics-fixture-password",
        "tls": False,
    }
    engine = create_engine(
        URL.create(
            "mysql+pymysql",
            username=cfg["username"],
            password=cfg["password"],
            host=cfg["host"],
            database="mysql",
        )
    )
    for attempt in range(30):
        try:
            with engine.begin() as conn:
                conn.execute(text("CREATE DATABASE IF NOT EXISTS diagnostics_fixture"))
            break
        except Exception:
            if attempt == 29:
                raise
            time.sleep(1)
    try:
        with engine.begin() as conn:
            conn.execute(
                text("CREATE TABLE diagnostics_fixture.parents(id INTEGER PRIMARY KEY)")
            )
            conn.execute(
                text(
                    "CREATE VIEW diagnostics_fixture.broken_view AS SELECT id FROM diagnostics_fixture.parents"
                )
            )
        good = connectors.scan("mariadb", cfg)
        assert len(good["tables"]) == 2
        with engine.begin() as conn:
            conn.execute(text("DROP TABLE diagnostics_fixture.parents"))
        connectors.connection_test("mariadb", cfg)
        with pytest.raises(connectors.ConnectorError) as caught:
            connectors.scan("mariadb", cfg)
        assert "MariaDB 1356" in str(caught.value) and "Spalten auslesen" in str(
            caught.value
        )
        assert cfg["password"] not in str(caught.value)
        with connectors.relational("mariadb", cfg) as conn:
            conn.execute(text("SET SESSION max_statement_time=0.01"))
            with pytest.raises(connectors.ConnectorError) as timeout:
                with connectors.scan_step("mariadb", "columns"):
                    conn.execute(text("SELECT SLEEP(0.1)"))
            assert "MariaDB 1969" in str(timeout.value) and "Zeitüberschreitung" in str(
                timeout.value
            )
    finally:
        with engine.begin() as conn:
            conn.execute(text("DROP DATABASE diagnostics_fixture"))
        engine.dispose()
