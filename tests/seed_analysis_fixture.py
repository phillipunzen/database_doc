"""Seed fictional sources in an empty disposable SQLite application instance."""

import os
import sqlite3
from pathlib import Path
from sqlalchemy import select, func
from app.models import Session, Source, Snapshot, User, Grant
from app.connectors import scan
from app.security import encrypt, hasher

assert os.environ.get("TEST_DATABASE_URL", "").startswith(
    "sqlite:"
), "Disposable SQLite instance required"
with Session() as db:
    assert (
        db.scalar(select(func.count()).select_from(Source)) == 0
    ), "Fixture must start with an empty source catalog"
    for source_name in ["Example ERP", "Example CRM"]:
        path = Path("/tmp") / (source_name.replace(" ", "-") + ".sqlite")
        with sqlite3.connect(path) as conn:
            conn.executescript(
                "CREATE TABLE customers(id INTEGER PRIMARY KEY, customer_number TEXT, balance NUMERIC, updated_at DATETIME); CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id)); CREATE VIEW customer_view AS SELECT id FROM customers;"
            )
            conn.executemany(
                "INSERT INTO customers VALUES(?,?,?,?)",
                [
                    (1, "fictional-001", 10, "2026-01-01"),
                    (2, "fictional-001", 20, "2026-01-02"),
                    (3, None, -2, "2026-01-03"),
                    (4, "", None, None),
                ],
            )
            for i in range(30):
                conn.execute(f"CREATE TABLE sample_{i:02d}(id INTEGER PRIMARY KEY)")
        source = Source(
            name=source_name,
            kind="sqlite",
            config_encrypted=encrypt({"path": str(path)}),
        )
        db.add(source)
        db.flush()
        db.add(
            Snapshot(source_id=source.id, payload=scan("sqlite", {"path": str(path)}))
        )
    for i in range(62):
        db.add(
            Source(
                name=f"Unscanned example {i:02d}",
                kind="sqlite",
                config_encrypted=encrypt({"path": "/tmp/not-connected.sqlite"}),
            )
        )
    reader = User(
        username="analysis-reader-ui",
        display_name="Analysis reader",
        role="viewer",
        password_hash=hasher.hash("analysis-reader-ui-password"),
    )
    db.add(reader)
    db.flush()
    db.add(Grant(source_id=1, user_id=reader.id))
    db.commit()
print("Fictional analysis fixture seeded: 64 sources, 2 scanned, 1 restricted reader.")
