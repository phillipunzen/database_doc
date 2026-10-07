"""Fictional fixtures for the browser; never use against the live catalog."""

import os, sqlite3
from pathlib import Path
from sqlalchemy import select, func
from app.models import Session, Source, Snapshot, User, Grant, BusinessConcept
from app.connectors import scan, table_key
from app.security import encrypt, hasher

assert os.environ.get("TEST_DATABASE_URL", "").startswith("sqlite:")
with Session() as db:
    assert db.scalar(select(func.count()).select_from(Source)) == 0
    for name in ["Example ERP", "Example CRM"]:
        path = Path("/tmp") / (name.replace(" ", "-") + ".sqlite")
        with sqlite3.connect(path) as conn:
            conn.executescript(
                "CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE addresses(id INTEGER PRIMARY KEY,customer_id INTEGER REFERENCES customers(id),street TEXT,city TEXT); CREATE TABLE t101(f001 TEXT);"
            )
            conn.executemany(
                "INSERT INTO addresses VALUES(?,?,?,?)",
                [
                    (n, None, "Other road " + str(n), "Other city")
                    for n in range(1, 2001)
                ],
            )
            conn.execute(
                "INSERT INTO addresses VALUES(2001,NULL,?,?)",
                ("Musterstraße 33", "Literal_100%[x]"),
            )
            for n in range(30):
                conn.execute(f"CREATE TABLE customer_archive_{n:02d}(address TEXT)")
        source = Source(
            name=name, kind="sqlite", config_encrypted=encrypt({"path": str(path)})
        )
        db.add(source)
        db.flush()
        snap = Snapshot(
            source_id=source.id, payload=scan("sqlite", {"path": str(path)})
        )
        db.add(snap)
        db.flush()
        if name == "Example ERP":
            db.add(
                BusinessConcept(
                    content={
                        "name": "Kundenadressen",
                        "definition": "Customer postal addresses",
                        "owner": "Fixture owner",
                        "leading_binding": 0,
                        "bindings": [
                            {
                                "source_id": source.id,
                                "snapshot_id": snap.id,
                                "table_key": table_key("", "t101"),
                                "column": "f001",
                                "table_name": "t101",
                                "data_type": "TEXT",
                                "transformation": "",
                            }
                        ],
                    }
                )
            )
    for n in range(62):
        db.add(
            Source(
                name=f"Unscanned example {n:02d}",
                kind="sqlite",
                config_encrypted=encrypt({"path": "/tmp/not-connected.sqlite"}),
            )
        )
    reader = User(
        username="finder-reader-ui",
        display_name="Finder reader",
        role="viewer",
        password_hash=hasher.hash("finder-reader-ui-password"),
    )
    db.add(reader)
    db.flush()
    db.add(Grant(source_id=1, user_id=reader.id))
    db.commit()
print("Fictional finder fixture: 64 sources, 2 scanned, restricted reader.")
