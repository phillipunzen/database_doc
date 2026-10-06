import json
import math
import os
import sqlite3
import time
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader
from app.main import app, login_attempts
from app.models import Session, Source, Snapshot, Note, SourceMetadata
from app.pdf_export import tables_pdf, er_pdf


def table(name, schema="öffentliche"):
    return {
        "key": json.dumps([schema, name], ensure_ascii=False, separators=(",", ":")),
        "schema": schema,
        "name": name,
        "kind": "table",
        "comment": "Größe & Qualität <script>literal</script>",
        "columns": [
            {
                "name": "id",
                "type": "INTEGER",
                "nullable": False,
                "primary_key": True,
                "default": None,
                "comment": "Schlüssel",
            },
            {
                "name": "konto_id",
                "type": "INTEGER",
                "nullable": True,
                "primary_key": False,
                "default": 0,
                "comment": "Referenz",
            },
        ],
        "primary_key": ["id"],
        "foreign_keys": [],
        "indexes": [{"name": "ix_konto", "columns": ["konto_id"], "unique": False}],
        "unique_constraints": [{"name": "uq_id", "columns": ["id"]}],
    }


def payload(tables):
    return {
        "source": {
            "name": "Übersicht & Datenbanken",
            "kind": "sqlite",
            "tags": ["Finance", "Österreich"],
            "owner": "Daten-Team",
            "owner_email": "data@example.org",
        },
        "snapshot_id": 7,
        "created": "2026-10-06T12:00:00Z",
        "schema": {"tables": tables, "warnings": [], "inferred": False},
        "notes": {},
    }


def read_pdf(content):
    assert content.startswith(b"%PDF-")
    reader = PdfReader(BytesIO(content), strict=True)
    assert not reader.is_encrypted
    return reader, "\n".join(page.extract_text() for page in reader.pages)


@pytest.fixture(scope="module")
def client():
    login_attempts.clear()
    with TestClient(app, headers={"Accept-Language": "de-DE"}) as client:
        result = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": os.environ["ADMIN_PASSWORD"]},
        )
        assert result.status_code == 200
        client.headers["x-csrf-token"] = result.json()["csrf"]
        yield client


@pytest.fixture(scope="module")
def catalog(client):
    path = Path(os.environ["SQLITE_ROOT"]) / "pdf-source.sqlite"
    with sqlite3.connect(path) as db:
        db.executescript(
            "CREATE TABLE secret_rows (id INTEGER, value TEXT); INSERT INTO secret_rows VALUES(1, 'PRIVATE_ROW_VALUE');"
        )
    source = client.post(
        "/api/sources",
        json={
            "name": "PDF Übersicht",
            "kind": "sqlite",
            "path": str(path),
            "password": "PDF_CONNECTION_SECRET",
        },
    ).json()["id"]
    other = client.post(
        "/api/sources",
        json={"name": "Other PDF source", "kind": "sqlite", "path": str(path)},
    ).json()["id"]
    parent, child = table("Kunden"), table('Bestellungen & "Details"')
    child["foreign_keys"] = [
        {
            "name": "fk_kunde",
            "columns": ["konto_id"],
            "target_schema": "öffentliche",
            "target_table": "Kunden",
            "target_columns": ["id"],
        }
    ]
    with Session() as db:
        old = Snapshot(source_id=source, payload=payload([parent, child])["schema"])
        db.add(old)
        db.flush()
        previous = old.id
        latest = Snapshot(source_id=source, payload=payload([parent])["schema"])
        db.add(latest)
        db.add(
            Note(
                source_id=source,
                table_key=parent["key"],
                text='Fachliche Größe <img src="file:///etc/passwd"/> <link href="https://example.invalid">literal</link>',
            )
        )
        db.add(
            SourceMetadata(
                source_id=source,
                tags=["Finance"],
                owner="Daten-Team",
                owner_email="data@example.org",
            )
        )
        db.commit()
        current = latest.id
    yield {
        "source": source,
        "other": other,
        "before": previous,
        "after": current,
        "parent": parent,
        "child": child,
    }
    for source_id in (source, other):
        assert client.delete(f"/api/sources/{source_id}").status_code == 200


def test_pdf_api_full_single_historical_and_literal_text(client, catalog):
    endpoint = f'/api/sources/{catalog["source"]}/export'
    response = client.get(
        endpoint, params={"format": "pdf", "snapshot_id": catalog["before"]}
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"].endswith('-tables.pdf"')
    reader, content = read_pdf(response.content)
    for value in (
        "PDF Übersicht",
        "Kunden",
        'Bestellungen & "Details"',
        "konto_id",
        "fk_kunde",
        "ix_konto",
        "uq_id",
        "Größe & Qualität <script>literal</script>",
        "Fachliche Größe",
        '<img src="file:///etc/passwd"/>',
        "Daten-Team",
    ):
        assert value in content
    assert "PRIVATE_ROW_VALUE" not in content
    assert "PDF_CONNECTION_SECRET" not in content
    assert str(catalog["before"]) in content
    assert all(
        float(page.mediabox.width) > float(page.mediabox.height)
        for page in reader.pages
    )
    assert all(not page.get("/Annots") for page in reader.pages)
    assert reader.outline
    single = client.get(
        endpoint,
        params={
            "format": "pdf",
            "snapshot_id": catalog["before"],
            "table_key": catalog["child"]["key"],
        },
    )
    assert single.status_code == 200
    assert single.headers["content-disposition"].endswith('-table.pdf"')
    _, selected = read_pdf(single.content)
    assert 'Bestellungen & "Details"' in selected
    assert "Fachliche Größe" not in selected
    _, latest = read_pdf(client.get(endpoint, params={"format": "pdf"}).content)
    assert 'Bestellungen & "Details"' not in latest
    assert (
        client.get(
            endpoint, params={"format": "pdf", "table_key": catalog["child"]["key"]}
        ).status_code
        == 404
    )
    assert (
        client.get(
            endpoint, params={"format": "pdf", "table_key": "missing"}
        ).status_code
        == 404
    )
    assert (
        client.get(
            endpoint, params={"format": "er_pdf", "table_key": catalog["parent"]["key"]}
        ).status_code
        == 422
    )
    assert (
        client.get(
            f'/api/sources/{catalog["other"]}/export',
            params={"format": "pdf", "snapshot_id": catalog["before"]},
        ).status_code
        == 404
    )
    assert (
        client.get(f'/api/sources/{catalog["other"]}/export?format=er_pdf').status_code
        == 404
    )


def test_pdf_download_permissions_without_data_grant(client, catalog):
    endpoint = f'/api/sources/{catalog["source"]}/export'
    assert TestClient(app).get(endpoint + "?format=pdf").status_code == 401
    user = client.post(
        "/api/users",
        json={
            "username": f"pdf-reader-{time.time_ns()}",
            "display_name": "PDF reader",
            "password": "pdf-reader-password",
            "role": "viewer",
        },
    ).json()
    viewer = TestClient(app)
    try:
        login = viewer.post(
            "/api/auth/login",
            json={"username": user["username"], "password": "pdf-reader-password"},
        ).json()
        viewer.headers["x-csrf-token"] = login["csrf"]
        for format in ("pdf", "er_pdf"):
            assert viewer.get(endpoint, params={"format": format}).status_code == 403
        assert (
            client.put(
                f'/api/sources/{catalog["source"]}/grants',
                json={"user_id": user["id"], "edit": False, "data": False},
            ).status_code
            == 200
        )
        for format in ("pdf", "er_pdf"):
            response = viewer.get(endpoint, params={"format": format})
            assert response.status_code == 200
            read_pdf(response.content)
        client.delete(f'/api/sources/{catalog["source"]}/grants/{user["id"]}')
        assert viewer.get(endpoint + "?format=pdf").status_code == 403

    finally:
        viewer.close()


def test_er_api_cross_schema_composite_external_and_self_relationships(client, catalog):
    t = table("Composite")
    t["foreign_keys"] = [
        {
            "name": "fk_composite",
            "columns": ["id", "konto_id"],
            "target_schema": "other_schema",
            "target_table": "Outside",
            "target_columns": ["pk_a", "pk_b"],
        },
        {
            "name": "fk_self",
            "columns": ["konto_id"],
            "target_schema": "öffentliche",
            "target_table": "Composite",
            "target_columns": ["id"],
        },
    ]
    with Session() as db:
        snap = Snapshot(source_id=catalog["source"], payload=payload([t])["schema"])
        db.add(snap)
        db.commit()
        snapshot_id = snap.id
    response = client.get(
        f'/api/sources/{catalog["source"]}/export',
        params={"format": "er_pdf", "snapshot_id": snapshot_id},
    )
    assert response.status_code == 200
    assert response.headers["content-disposition"].endswith('-er.pdf"')
    reader, content = read_pdf(response.content)
    for expected in (
        "Composite",
        "other_schema.Outside",
        "id, konto_id",
        "pk_a, pk_b",
        "fk_self",
        "fk_composite",
        "Extern / nicht im Scan",
        "Beziehungsverzeichnis",
    ):
        assert expected in content
    assert float(reader.pages[0].mediabox.width) > 1100
    assert (
        b" c" in reader.pages[0].get_contents().get_data()
    )  # Cards/curves are vectors.
    assert not any(list(page.images) for page in reader.pages)
    assert reader.outline


def test_long_table_and_oversized_cells_split_across_pages():
    t = table("Lange_Dokumentation")
    t["columns"] = [
        {
            "name": f"field_{i:03}",
            "type": "VARCHAR(200)",
            "nullable": True,
            "default": None,
            "primary_key": False,
            "comment": "Ausführlicher Kommentar mit Umlauten: Größe, Änderung und Übersicht.",
        }
        for i in range(170)
    ]
    t["columns"][0]["comment"] = "Sehr langer Inhalt " * 2000 + "END_OF_LONG_CELL"
    p = payload([t])
    p["notes"][t["key"]] = "Sehr lange Notiz " * 1800 + "END_OF_LONG_NOTE"
    reader, content = read_pdf(tables_pdf(p, [t]))
    assert len(reader.pages) > 8
    assert "field_169" in content
    assert "END_OF_LONG_CELL" in content
    assert "END_OF_LONG_NOTE" in content
    assert content.count("Spalte / Feld") > 4


def test_large_er_contains_every_object_and_cross_page_references():
    tables = [table(f"object_{i:03}", "warehouse") for i in range(85)]
    for i, t in enumerate(tables):
        t["foreign_keys"] = [
            {
                "name": f"fk_chain_{i:03}",
                "columns": ["konto_id"],
                "target_schema": "warehouse",
                "target_table": tables[(i + 1) % len(tables)]["name"],
                "target_columns": ["id"],
            }
        ]
    reader, content = read_pdf(er_pdf(payload(tables)))
    assert len(reader.pages) > math.ceil(85 / 6)
    assert "Diagramm 15 von 15" in content
    assert "D.15" in content
    for t in tables:
        assert t["name"] in content
        assert t["foreign_keys"][0]["name"] in content
    assert all(float(page.mediabox.width) > 1100 for page in reader.pages)
    assert any(page.get("/Annots") for page in reader.pages[:15])
    assert "Objektverzeichnis" in content
    assert "Beziehungsverzeichnis" in content


def test_empty_and_inferred_schemas_export_valid_pdfs():
    reader, content = read_pdf(er_pdf(payload([])))
    assert len(reader.pages) == 1
    assert "Keine zugänglichen Objekte" in content
    reader, content = read_pdf(tables_pdf(payload([]), []))
    assert len(reader.pages) == 1
    inferred = payload([table("customers")])
    inferred["source"]["kind"] = "mongodb"
    inferred["schema"]["inferred"] = True
    inferred["schema"]["warnings"] = ["Felder beruhen auf Stichproben."]
    inferred["schema"]["tables"][0]["validator"] = {
        "$jsonSchema": {"required": ["name"]}
    }
    _, content = read_pdf(er_pdf(inferred))
    assert "Keine deklarierten Fremdschlüssel" in content
    assert "Stichproben" in content
    _, content = read_pdf(tables_pdf(inferred, inferred["schema"]["tables"]))
    assert "$jsonSchema" in content
