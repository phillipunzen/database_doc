import os
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin
from pypdf import PdfReader
from sqlalchemy import delete, select

from app.main import app, login_attempts
from app.models import ApplicationBranding, Audit, Session, Source, Snapshot


def logo_bytes(format="PNG", size=(240, 80)):
    buffer = BytesIO()
    image = Image.new("RGBA" if format == "PNG" else "RGB", size, "#286454")
    extra = {}
    if format == "PNG":
        metadata = PngImagePlugin.PngInfo()
        metadata.add_text("Comment", "PRIVATE_IMAGE_METADATA")
        extra["pnginfo"] = metadata
    image.save(buffer, format=format, **extra)
    return buffer.getvalue()


@pytest.fixture(scope="module")
def admin():
    login_attempts.clear()
    with TestClient(app, headers={"Accept-Language": "en-US"}) as client:
        login = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": os.environ["ADMIN_PASSWORD"]},
        )
        assert login.status_code == 200
        client.headers["x-csrf-token"] = login.json()["csrf"]
        yield client


@pytest.fixture(autouse=True)
def empty_branding(admin):
    with Session() as db:
        db.execute(delete(ApplicationBranding))
        db.commit()
    yield
    with Session() as db:
        db.execute(delete(ApplicationBranding))
        db.commit()


@pytest.mark.parametrize("format", ["PNG", "JPEG", "WEBP"])
def test_upload_replace_public_read_and_remove(admin, format):
    anonymous = TestClient(app)
    assert anonymous.get("/api/branding").json() == {"logo_url": None}
    assert anonymous.get("/api/branding/logo").status_code == 404
    result = admin.put(
        "/api/branding/logo",
        content=logo_bytes(format),
        headers={"Content-Type": "application/octet-stream"},
    )
    assert result.status_code == 200
    url = result.json()["logo_url"]
    response = anonymous.get(url)
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "no-store"
    image = Image.open(BytesIO(response.content))
    assert image.size == (240, 80)
    assert "PRIVATE_IMAGE_METADATA" not in str(image.info)
    with Session() as db:
        assert db.get(ApplicationBranding, 1).logo == response.content
    replacement = admin.put("/api/branding/logo", content=logo_bytes(size=(1800, 600)))
    assert replacement.status_code == 200
    assert replacement.json()["logo_url"] != url
    image = Image.open(BytesIO(anonymous.get(replacement.json()["logo_url"]).content))
    assert image.size == (1200, 400)
    assert admin.delete("/api/branding/logo").json() == {"logo_url": None}
    assert anonymous.get("/api/branding/logo").status_code == 404
    assert admin.delete("/api/branding/logo").status_code == 200
    with Session() as db:
        assert db.scalar(select(Audit).where(Audit.action == "company_logo_updated"))
        assert db.scalar(select(Audit).where(Audit.action == "company_logo_removed"))


def test_upload_permissions_csrf_and_origin(admin):
    image = logo_bytes()
    anonymous = TestClient(app)
    assert anonymous.put("/api/branding/logo", content=image).status_code == 401
    assert anonymous.delete("/api/branding/logo").status_code == 401
    assert (
        admin.put(
            "/api/branding/logo", content=image, headers={"x-csrf-token": ""}
        ).status_code
        == 403
    )
    assert (
        admin.delete("/api/branding/logo", headers={"x-csrf-token": ""}).status_code
        == 403
    )
    assert (
        admin.put(
            "/api/branding/logo",
            content=image,
            headers={"origin": "https://evil.invalid"},
        ).status_code
        == 403
    )
    for role in ["viewer", "editor"]:
        user = admin.post(
            "/api/users",
            json={
                "username": f"branding-{role}",
                "display_name": "Logo test",
                "role": role,
                "password": "branding-user-password",
            },
        )
        assert user.status_code == 200
        with TestClient(app) as reader:
            login = reader.post(
                "/api/auth/login",
                json={
                    "username": f"branding-{role}",
                    "password": "branding-user-password",
                },
            )
            reader.headers["x-csrf-token"] = login.json()["csrf"]
            assert reader.get("/api/branding").status_code == 200
            assert reader.put("/api/branding/logo", content=image).status_code == 403
            assert reader.delete("/api/branding/logo").status_code == 403


def test_invalid_upload_keeps_existing_logo_and_localizes_errors(admin):
    url = admin.put("/api/branding/logo", content=logo_bytes()).json()["logo_url"]
    animated = BytesIO()
    Image.new("RGB", (10, 10), "red").save(
        animated,
        format="PNG",
        save_all=True,
        append_images=[Image.new("RGB", (10, 10), "blue")],
    )
    invalids = [
        (b"", 422),
        (
            b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            422,
        ),
        (b"not an image", 422),
        (logo_bytes()[:30], 422),
        (logo_bytes("GIF"), 422),
        (animated.getvalue(), 422),
        (logo_bytes(size=(4097, 1)), 422),
        (logo_bytes(size=(2100, 2000)), 422),
        (b"x" * (2 * 1024 * 1024 + 1), 413),
    ]
    for data, status in invalids:
        assert admin.put("/api/branding/logo", content=data).status_code == status
        assert admin.get("/api/branding").json()["logo_url"] == url
    result = admin.put(
        "/api/branding/logo", content=b"x", headers={"Accept-Language": "de-DE"}
    )
    assert "gültiges PNG" in result.json()["detail"]
    result = admin.put(
        "/api/branding/logo", content=b"x", headers={"Accept-Language": "en-US"}
    )
    assert "valid PNG" in result.json()["detail"]


def test_logo_in_table_and_er_exports_only(admin):
    path = Path(os.environ["SQLITE_ROOT"]) / "branding.sqlite"
    path.touch()
    result = admin.post(
        "/api/sources",
        json={"name": "Branding export example", "kind": "sqlite", "path": str(path)},
    )
    assert result.status_code == 200, result.text
    source = result.json()
    with Session() as db:
        db.add(Snapshot(source_id=source["id"], payload={"tables": [], "warnings": []}))
        db.commit()
    try:
        admin.put("/api/branding/logo", content=logo_bytes())
        for format in ["pdf", "er_pdf"]:
            result = admin.get(f'/api/sources/{source["id"]}/export?format={format}')
            assert result.status_code == 200
            pdf = PdfReader(BytesIO(result.content))
            assert all(len(page.images) == 1 for page in pdf.pages)
            assert "DatabaseDoc" in pdf.pages[0].extract_text()
        result = admin.get(f'/api/sources/{source["id"]}/export?format=json')
        assert "logo" not in result.text
        admin.delete("/api/branding/logo")
        result = admin.get(f'/api/sources/{source["id"]}/export?format=pdf')
        assert len(PdfReader(BytesIO(result.content)).pages[0].images) == 0
    finally:
        admin.delete(f'/api/sources/{source["id"]}')
