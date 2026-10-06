import json
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.i18n import LANGUAGE, MESSAGES, negotiate_language, tr
from app.main import app
from app.pdf_export import tables_pdf


def test_language_negotiation():
    cases = {
        "de-DE,de;q=0.9,en;q=0.8": "de",
        "en-US,en;q=0.9,de;q=0.1": "en",
        "fr-FR,pt;q=0.8": "en",
        "fr-FR,de-AT;q=0.8,en;q=0.5": "de",
        "de;q=0,en;q=0.2": "en",
        "de;q=bad,en;q=1": "en",
        "de;q=0.2,en;q=0.9": "en",
        "": "en",
    }
    for header, expected in cases.items():
        assert negotiate_language(header) == expected


def test_catalog_parameters_and_literal_user_values():
    for source, target in MESSAGES.items():
        import re

        assert sorted(re.findall(r"\{\d+\}", source)) == sorted(
            re.findall(r"\{\d+\}", target)
        ), source
    token = LANGUAGE.set("en")
    try:
        assert (
            tr("{0}: Granularität fehlt.", "Datenquellen {0} <script>")
            == "Datenquellen {0} <script>: grain missing."
        )
    finally:
        LANGUAGE.reset(token)


def test_request_languages_are_isolated_and_catalog_is_public():
    with TestClient(app) as client:

        def read(language):
            result = client.get("/api/auth/me", headers={"Accept-Language": language})
            return language, result

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(read, ["de-DE", "en-US"] * 6))
        for language, response in results:
            assert response.status_code == 401
            assert response.headers["content-language"] == language[:2]
            assert response.json()["detail"] == (
                "Bitte anmelden." if language.startswith("de") else "Please sign in."
            )
        result = client.get("/api/i18n/en.js")
        assert result.status_code == 200
        assert (
            json.loads(
                result.text.removeprefix("const UI_TRANSLATIONS = ").removesuffix(";")
            )
            == MESSAGES
        )
        assert "application/javascript" in result.headers["content-type"]


def test_pdf_localizes_labels_without_translating_notes_or_names():
    table = {
        "name": "Datenquellen",
        "schema": "public",
        "key": "fixture",
        "kind": "table",
        "columns": [],
        "primary_key": [],
        "foreign_keys": [],
        "indexes": [],
        "unique_constraints": [],
    }
    payload = {
        "source": {"name": "Datenquellen", "kind": "postgresql"},
        "snapshot_id": 1,
        "created": "2026-10-06T12:00:00Z",
        "schema": {"tables": [table], "warnings": []},
        "notes": {"fixture": "Beschreibung & Fachwissen"},
    }
    for language in ["de", "en"]:
        token = LANGUAGE.set(language)
        try:
            document = tables_pdf(payload, [table])
        finally:
            LANGUAGE.reset(token)
        text = "\n".join(
            page.extract_text() for page in PdfReader(BytesIO(document)).pages
        )
        assert "Datenquellen" in text
        assert "Beschreibung & Fachwissen" in text
        assert (
            "Table documentation" if language == "en" else "Tabellendokumentation"
        ) in text


def test_warehouse_markdown_and_api_follow_each_request_language():
    import os
    from uuid import uuid4

    with TestClient(app) as client:
        login = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": os.environ["ADMIN_PASSWORD"]},
        ).json()
        client.headers["x-csrf-token"] = login["csrf"]
        project = client.post(
            "/api/dwh/projects",
            json={
                "name": "Datenquellen",
                "goal": "Beschreibung & Fachwissen",
                "target_kind": "postgresql",
                "target_schema": "warehouse",
                "source_ids": [],
                "tables": [
                    {
                        "id": str(uuid4()),
                        "name": "Datenquellen",
                        "role": "fact",
                        "layer": "core",
                        "grain": "Beschreibung",
                        "columns": [],
                        "relations": [],
                    }
                ],
            },
        ).json()
        endpoint = f'/api/dwh/projects/{project["id"]}'
        try:
            for language, role, status, missing in [
                ("de-DE", "Fakt", "Geplant", "Zielspalten fehlen"),
                ("en-US", "Fact", "Planned", "target columns missing"),
            ]:
                headers = {"Accept-Language": language}
                detail = client.get(endpoint, headers=headers)
                assert detail.headers["content-language"] == language[:2]
                assert any(missing in issue for issue in detail.json()["issues"])
                markdown = client.get(
                    endpoint + "/export?format=markdown", headers=headers
                ).text
                assert f"{role} · Core · {status}" in markdown
                assert "# Datenquellen" in markdown
                assert "Beschreibung & Fachwissen" in markdown
                bad = client.get(endpoint + "/export?format=sql", headers=headers)
                assert bad.status_code == 422
                assert (
                    "mindestens eine Spalte"
                    if language.startswith("de")
                    else "at least one column"
                ) in bad.json()["detail"]
            origin = client.post(
                "/api/dwh/projects",
                headers={
                    "Accept-Language": "en",
                    "Origin": "https://untrusted.example",
                },
                json={},
            )
            assert (
                origin.status_code == 403
                and origin.json()["detail"] == "Origin not allowed."
            )
        finally:
            assert (
                client.delete(
                    endpoint, params={"version": project["version"]}
                ).status_code
                == 200
            )
