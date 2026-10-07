"""Application-wide company logo, persisted as a normalized raster image."""

import hashlib
import warnings
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from .i18n import tr
from .models import ApplicationBranding, Session, User, now
from .security import audit, current, require_admin

router = APIRouter(prefix="/api/branding")
MAX_UPLOAD = 2 * 1024 * 1024


def branding_json(version=None):
    return {"logo_url": f"/api/branding/logo?v={version}" if version else None}


def normalize_logo(data):
    if not data:
        raise HTTPException(422, tr("Bitte eine Bilddatei auswählen."))
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data), formats=["PNG", "JPEG", "WEBP"]) as image:
                width, height = image.size
                if width > 4096 or height > 4096 or width * height > 4_000_000:
                    raise HTTPException(
                        422,
                        tr(
                            "Das Logo darf höchstens 4096 Pixel je Seite und 4 Millionen Pixel insgesamt haben."
                        ),
                    )
                if getattr(image, "n_frames", 1) != 1:
                    raise HTTPException(
                        422, tr("Bitte ein nicht animiertes Logo verwenden.")
                    )
                image.load()
                normalized = ImageOps.exif_transpose(image).convert("RGBA")
                normalized.thumbnail((1200, 400), Image.Resampling.LANCZOS)
                # Copy pixels into a fresh image to omit EXIF, comments and profiles.
                clean = Image.new("RGBA", normalized.size)
                clean.paste(normalized)
                result = BytesIO()
                clean.save(result, format="PNG")
                return result.getvalue()
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        SyntaxError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise HTTPException(
            422, tr("Bitte ein gültiges PNG-, JPEG- oder WebP-Bild hochladen.")
        ) from None


@router.get("")
def get_branding():
    # Public by design: the same logo is displayed before sign-in.
    with Session() as db:
        version = db.scalar(
            select(ApplicationBranding.version).where(ApplicationBranding.id == 1)
        )
        return branding_json(version)


@router.get("/logo")
def get_logo():
    with Session() as db:
        branding = db.get(ApplicationBranding, 1)
        if not branding:
            raise HTTPException(404, tr("Kein Firmenlogo hinterlegt."))
        return Response(branding.logo, media_type="image/png")


def save_logo(data, user):
    logo = normalize_logo(data)
    version = hashlib.sha256(logo).hexdigest()
    with Session() as db:
        branding = db.get(ApplicationBranding, 1)
        if branding:
            branding.logo = logo
            branding.version = version
            branding.updated = now()
        else:
            db.add(ApplicationBranding(id=1, logo=logo, version=version))
        audit(db, user, "company_logo_updated")
        db.commit()
    return branding_json(version)


@router.put("/logo")
async def upload_logo(request: Request, user: User = Depends(current)):
    require_admin(user)
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_UPLOAD:
            raise HTTPException(413, tr("Das Logo darf höchstens 2 MB groß sein."))
        data.extend(chunk)
    return await run_in_threadpool(save_logo, bytes(data), user)


@router.delete("/logo")
def remove_logo(user: User = Depends(current)):
    require_admin(user)
    with Session() as db:
        branding = db.get(ApplicationBranding, 1)
        if branding:
            db.delete(branding)
            audit(db, user, "company_logo_removed")
            db.commit()
    return branding_json()
