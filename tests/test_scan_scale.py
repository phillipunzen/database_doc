"""Large metadata scans using disposable SQLite and simulated server catalogs."""

import hashlib
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Integer, select, func
from sqlalchemy.engine.default import DefaultDialect

from app import connectors
from app.jobs import run_scan
from app.main import app
from app.models import Session, Source, Job, Snapshot, SearchEntry
from app.security import encrypt


def test_large_sqlite_scan_is_saved_and_fully_indexed():
    path = Path(os.environ["SQLITE_ROOT"]) / "large-scan.sqlite"
    with sqlite3.connect(path) as conn:
        conn.executescript(
            "".join(
                f"CREATE TABLE table_{i:04d}(id INTEGER PRIMARY KEY);"
                for i in range(2100)
            )
            + "CREATE TABLE tail_child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES table_2099(id));"
            + "CREATE VIEW tail_view AS SELECT id FROM table_2099;"
        )
    before = hashlib.sha256(path.read_bytes()).digest()
    with TestClient(app), Session() as db:
        source = Source(
            name="Large scan fixture",
            kind="sqlite",
            config_encrypted=encrypt({"path": str(path)}),
        )
        db.add(source)
        db.flush()
        job = Job(source_id=source.id)
        db.add(job)
        db.commit()
        job_id, source_id = job.id, source.id
    run_scan(job_id)
    with Session() as db:
        assert db.get(Job, job_id).status == "completed"
        snapshot = db.scalar(select(Snapshot).where(Snapshot.source_id == source_id))
        tables = snapshot.payload["tables"]
        assert len(tables) == 2102
        assert len({t["key"] for t in tables}) == 2102
        child = next(t for t in tables if t["name"] == "tail_child")
        assert child["foreign_keys"][0]["target_table"] == "table_2099"
        assert next(t for t in tables if t["name"] == "tail_view")["kind"] == "view"
        assert (
            db.scalar(
                select(func.count())
                .select_from(SearchEntry)
                .where(SearchEntry.source_id == source_id, SearchEntry.kind == "table")
            )
            == 2102
        )
        assert (
            db.scalar(
                select(SearchEntry).where(
                    SearchEntry.source_id == source_id,
                    SearchEntry.title == "tail_view.id",
                )
            )
            is not None
        )
    assert hashlib.sha256(path.read_bytes()).digest() == before


@pytest.mark.parametrize("kind", ["mssql", "postgresql"])
def test_large_scan_spans_application_schemas(monkeypatch, kind):
    inspector = Mock()
    inspector.get_schema_names.return_value = [
        "application",
        "reporting",
        "sys",
        "pg_catalog",
    ]
    inspector.get_table_names.side_effect = lambda schema: [
        f"table_{i:04d}" for i in range(1500 if schema == "application" else 600)
    ]
    inspector.get_view_names.return_value = ["summary_view"]
    inspector.get_columns.return_value = [
        {"name": "id", "type": Integer(), "nullable": False}
    ]
    inspector.get_pk_constraint.return_value = {"constrained_columns": ["id"]}
    inspector.get_foreign_keys.return_value = []
    inspector.get_indexes.return_value = []
    inspector.get_unique_constraints.return_value = []
    inspector.get_table_comment.return_value = {"text": "Catalog fixture"}

    @contextmanager
    def connection(*args):
        yield SimpleNamespace(dialect=DefaultDialect())

    monkeypatch.setattr(connectors, "relational", connection)
    monkeypatch.setattr(connectors, "inspect", lambda conn: inspector)
    payload = connectors.scan(kind, {})
    assert len(payload["tables"]) == 2102
    assert {t["schema"] for t in payload["tables"]} == {"application", "reporting"}
    assert len({t["key"] for t in payload["tables"]}) == 2102
    assert payload["tables"][-1]["name"] == "summary_view"
    assert payload["tables"][-1]["kind"] == "view"
    assert payload["tables"][-1]["columns"][0]["primary_key"] is True
    filtered = connectors.scan(kind, {"schema": "reporting"})
    assert len(filtered["tables"]) == 601
    assert {t["schema"] for t in filtered["tables"]} == {"reporting"}


def test_large_mongo_catalog_retains_all_collections_and_views(monkeypatch):
    catalog = [
        {"name": f"collection_{i:04d}", "type": "collection"} for i in range(2100)
    ]
    catalog.append({"name": "tail_view", "type": "view"})
    db = MagicMock()
    db.list_collections.side_effect = lambda: iter(catalog)
    collection = Mock()
    collection.list_indexes.return_value = [
        {"name": "_id_", "key": {"_id": 1}, "unique": True}
    ]
    db.__getitem__.return_value = collection

    @contextmanager
    def connection(*args):
        yield db

    monkeypatch.setattr(connectors, "mongo", connection)
    payload = connectors.scan("mongodb", {"database": "fixture"}, infer=False)
    assert len(payload["tables"]) == 2101
    assert len({t["key"] for t in payload["tables"]}) == 2101
    assert payload["tables"][2099]["indexes"][0]["name"] == "_id_"
    assert payload["tables"][-1]["kind"] == "view"
    assert payload["tables"][-1]["indexes"] == []
    assert all(
        t["sampled_documents"] == 0 and t["columns"] == [] for t in payload["tables"]
    )
    collection.find.assert_not_called()
    assert collection.list_indexes.call_count == 2100
