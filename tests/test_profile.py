"""Personal language persistence, backend negotiation and profile access boundaries."""

import hashlib
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from fastapi.testclient import TestClient
from sqlalchemy import select, delete
import pytest
from app.main import app
from app.models import Session, User, UserPreference, LoginSession, Audit, now
from app.security import hasher, issue_session
from starlette.responses import Response


@pytest.fixture(scope="module")
def people():
    with TestClient(app, client=("profile-tests", 50000)) as admin:
        r = admin.post(
            "/api/auth/login",
            json={"username": "admin", "password": os.environ["ADMIN_PASSWORD"]},
        )
        assert r.status_code == 200
        admin.headers["x-csrf-token"] = r.json()["csrf"]
        clients = {}
        ids = {}
        for role in ["viewer", "editor"]:
            username = "profile-" + role
            r = admin.post(
                "/api/users",
                json={
                    "username": username,
                    "display_name": role + " original",
                    "role": role,
                    "password": "profile-test-password-123",
                },
            )
            assert r.status_code == 200
            ids[role] = r.json()["id"]
            c = TestClient(app, client=("profile-tests", 50000))
            r = c.post(
                "/api/auth/login",
                json={"username": username, "password": "profile-test-password-123"},
            )
            assert r.status_code == 200, r.text
            c.headers["x-csrf-token"] = r.json()["csrf"]
            clients[role] = c
        yield admin, clients, ids
        for c in clients.values():
            c.close()
        with Session() as db:
            db.execute(delete(UserPreference))
            db.commit()


def test_profile_defaults_self_only_and_input_boundaries(people):
    admin, clients, ids = people
    c = clients["viewer"]
    p = c.get("/api/profile", headers={"Accept-Language": "de-DE"})
    assert p.status_code == 200
    assert p.json()["language"] == "auto" and p.json()["effective_language"] == "de"
    assert p.json()["user"]["id"] == ids["viewer"] and "password_hash" not in p.text
    with Session() as db:
        original = db.get(User, ids["viewer"])
        password_hash = original.password_hash
    for body in [
        {"language": "fr"},
        {"language": "en", "role": "admin"},
        {"language": "en", "user_id": 1},
        {"language": "en", "display_name": "  "},
        {"language": "en", "display_name": "x" * 191},
    ]:
        assert c.put("/api/profile", json=body).status_code == 422
    csrf = c.headers.pop("x-csrf-token")
    assert c.put("/api/profile", json={"language": "en"}).status_code == 403
    c.headers["x-csrf-token"] = csrf
    assert (
        c.put(
            "/api/profile",
            json={"language": "en"},
            headers={"Origin": "https://foreign.invalid"},
        ).status_code
        == 403
    )
    assert (
        TestClient(app, client=("profile-tests", 50000)).get("/api/profile").status_code
        == 401
    )
    assert (
        TestClient(app, client=("profile-tests", 50000))
        .put("/api/profile", json={"language": "en"})
        .status_code
        == 401
    )
    r = c.put(
        "/api/profile",
        json={"language": "en", "display_name": "  Literal <script>profile</script>  "},
    )
    assert r.status_code == 200
    assert r.json()["user"]["display_name"] == "Literal <script>profile</script>"
    with Session() as db:
        user = db.get(User, ids["viewer"])
        assert (
            user.role == "viewer"
            and user.active
            and user.password_hash == password_hash
        )
        assert db.get(UserPreference, 1) is None
        logs = db.scalars(select(Audit).where(Audit.action == "profile_updated")).all()
        assert (
            logs[-1].target == str(ids["viewer"]) and "<script>" not in logs[-1].target
        )


def test_language_overrides_request_headers_and_isolates_accounts(people):
    _, clients, ids = people
    for role, lang in [("viewer", "en"), ("editor", "de")]:
        assert (
            clients[role].put("/api/profile", json={"language": lang}).status_code
            == 200
        )

    def read(role):
        c = clients[role]
        r = c.get(
            "/api/profile",
            headers={"Accept-Language": "de-DE" if role == "viewer" else "en-US"},
        )
        return role, r

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(read, ["viewer", "editor"] * 4))
    for role, r in results:
        lang = "en" if role == "viewer" else "de"
        assert (
            r.headers["content-language"] == lang
            and r.json()["effective_language"] == lang
        )
        script = clients[role].get("/api/i18n/preference.js")
        assert script.text == f'const UI_PROFILE_LANGUAGE = "{lang}";'
        assert script.headers["cache-control"] == "no-store"
    r = clients["viewer"].get("/api/users", headers={"Accept-Language": "de"})
    assert (
        r.status_code == 403
        and r.headers["content-language"] == "en"
        and "Only administrators" in r.text
    )
    assert clients["viewer"].get("/api/auth/me").json()["user"]["language"] == "en"
    # A separate session with different browser settings gets the stored preference.
    with TestClient(app, client=("profile-tests", 50000)) as another:
        r = another.post(
            "/api/auth/login",
            json={
                "username": "profile-viewer",
                "password": "profile-test-password-123",
            },
            headers={"Accept-Language": "de"},
        )
        assert r.status_code == 200 and r.json()["user"]["language"] == "en"
        assert (
            another.get("/api/profile", headers={"Accept-Language": "de"}).json()[
                "effective_language"
            ]
            == "en"
        )
    assert (
        clients["viewer"].put("/api/profile", json={"language": "auto"}).status_code
        == 200
    )
    for header, lang in [("de-AT", "de"), ("en-US", "en"), ("fr-FR", "en")]:
        assert (
            clients["viewer"]
            .get("/api/profile", headers={"Accept-Language": header})
            .json()["effective_language"]
            == lang
        )


def test_expired_deactivated_and_logged_out_sessions_do_not_leak_preferences(people):
    _, clients, ids = people
    with Session() as db:
        u = User(
            username="profile-session-test",
            display_name="Session test",
            role="viewer",
            password_hash=hasher.hash("profile-test-password-123"),
        )
        db.add(u)
        db.flush()
        db.add(UserPreference(user_id=u.id, language="de"))
        response = Response()
        csrf = issue_session(db, u, response)
        uid = u.id
    token = response.headers["set-cookie"].split("=", 1)[1].split(";", 1)[0]
    c = TestClient(app, client=("profile-tests", 50000))
    c.cookies.set("datatlas_session", token)
    c.headers["x-csrf-token"] = csrf
    assert c.get("/api/i18n/preference.js").text.endswith('"de";')
    with Session() as db:
        session = db.get(LoginSession, hashlib.sha256(token.encode()).hexdigest())
        session.expires = now() - timedelta(seconds=1)
        db.commit()
    assert c.get("/api/profile").status_code == 401 and c.get(
        "/api/i18n/preference.js"
    ).text.endswith('"auto";')
    with Session() as db:
        session = db.get(LoginSession, hashlib.sha256(token.encode()).hexdigest())
        session.expires = now() + timedelta(hours=1)
        db.get(User, uid).active = False
        db.commit()
    assert c.put("/api/profile", json={"language": "en"}).status_code == 401 and c.get(
        "/api/i18n/preference.js"
    ).text.endswith('"auto";')
    c.close()
    assert clients["editor"].post("/api/auth/logout", json={}).status_code == 200
    assert clients["editor"].get("/api/i18n/preference.js").text.endswith('"auto";')
    assert clients["editor"].get("/api/profile").status_code == 401


def test_external_accounts_can_set_language_but_not_identity(people):
    _, _, _ = people
    with Session() as db:
        u = User(
            username="profile-entra",
            display_name="External identity",
            identity="entra:fixture:profile",
            role="viewer",
        )
        db.add(u)
        db.flush()
        response = Response()
        csrf = issue_session(db, u, response)
        uid = u.id
    token = response.headers["set-cookie"].split("=", 1)[1].split(";", 1)[0]
    with TestClient(app, client=("profile-tests", 50000)) as c:
        c.cookies.set("datatlas_session", token)
        c.headers["x-csrf-token"] = csrf
        assert c.put("/api/profile", json={"language": "de"}).status_code == 200
        assert c.get("/api/profile").json()["user"]["provider"] == "entra"
        assert (
            c.put(
                "/api/profile",
                json={"language": "en", "display_name": "Changed identity"},
            ).status_code
            == 422
        )
        with Session() as db:
            assert (
                db.get(User, uid).display_name == "External identity"
                and db.get(UserPreference, uid).language == "de"
            )
