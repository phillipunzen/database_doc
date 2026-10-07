"""Create an old account before startup, then seed a fictional source for UI checks."""

import os, sys, sqlite3
from sqlalchemy import select, func
from app.models import Session, User, Source, Snapshot, UserPreference, engine
from app.security import hasher, encrypt, issue_session
from starlette.responses import Response
from pathlib import Path
import json
from app.connectors import scan

assert (
    os.getenv("APP_DB_HOST") == "databasedoc-profile-mariadb"
    and os.getenv("PROFILE_FIXTURE") == "1"
), "Disposable MariaDB fixture required"
if sys.argv[-1] == "legacy":
    User.__table__.create(engine)
    with Session() as db:
        db.add(
            User(
                username="admin",
                display_name="Legacy Administrator",
                role="admin",
                password_hash=hasher.hash(os.environ["ADMIN_PASSWORD"]),
            )
        )
        db.commit()
    print("Legacy user table seeded before profile migration.")
else:
    with Session() as db:
        assert db.scalar(select(func.count()).select_from(User)) == 1
        assert db.scalar(select(func.count()).select_from(Source)) == 0
        assert db.scalar(select(func.count()).select_from(UserPreference)) == 0
        assert db.scalar(select(User.display_name)) == "Legacy Administrator"
        path = "/tmp/profile-source.sqlite"
        with sqlite3.connect(path) as conn:
            conn.executescript(
                "CREATE TABLE addresses(id INTEGER PRIMARY KEY,street TEXT);"
            )
        s = Source(
            name="Datenquellen", kind="sqlite", config_encrypted=encrypt({"path": path})
        )
        db.add(s)
        db.flush()
        db.add(Snapshot(source_id=s.id, payload=scan("sqlite", {"path": path})))
        for name, role, identity in [
            ("profile-reader", "viewer", None),
            ("profile-editor", "editor", None),
            ("profile-entra", "viewer", "entra:fixture:browser"),
        ]:
            u = User(
                username=name,
                display_name=name,
                role=role,
                identity=identity,
                password_hash=(
                    None if identity else hasher.hash("profile-reader-password-123")
                ),
            )
            db.add(u)
            db.flush()
            if identity:
                response = Response()
                issue_session(db, u, response)
                token = response.headers["set-cookie"].split("=", 1)[1].split(";", 1)[0]
                p = Path("/tmp/profile-external-session.json")
                p.write_text(json.dumps({"token": token}))
                p.chmod(0o600)
        db.commit()
    print(
        "Migration preserved existing account; fictional source and restricted accounts seeded."
    )
