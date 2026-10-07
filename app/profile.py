"""Personal settings; browser language remains the default for existing accounts."""

import hashlib
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import select
from .models import Session, User, UserPreference, LoginSession, now
from .security import current, user_json, audit
from .i18n import LANGUAGE, tr

router = APIRouter(prefix="/api/profile")


def language_for(db, user_id):
    preference = db.get(UserPreference, user_id)
    return (
        preference.language
        if preference and preference.language in {"de", "en"}
        else "auto"
    )


def request_preference(token):
    if not token:
        return "auto"
    with Session() as db:
        language = db.scalar(
            select(UserPreference.language)
            .select_from(LoginSession)
            .join(User, User.id == LoginSession.user_id)
            .outerjoin(UserPreference, UserPreference.user_id == User.id)
            .where(
                LoginSession.token_hash == hashlib.sha256(token.encode()).hexdigest(),
                LoginSession.expires > now(),
                User.active.is_(True),
            )
        )
        return language if language in {"de", "en"} else "auto"


def profile_json(db, user):
    return {
        "user": user_json(user),
        "language": language_for(db, user.id),
        "effective_language": LANGUAGE.get(),
    }


class ProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    language: Literal["auto", "de", "en"]
    display_name: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=190)
        ]
        | None
    ) = None


@router.get("")
def get_profile(user: User = Depends(current)):
    with Session() as db:
        record = db.get(User, user.id)
        if not record or not record.active:
            raise HTTPException(401, tr("Konto ist deaktiviert."))
        return profile_json(db, record)


@router.put("")
def save_profile(body: ProfileInput, user: User = Depends(current)):
    with Session() as db:
        record = db.scalar(select(User).where(User.id == user.id).with_for_update())
        if not record or not record.active:
            raise HTTPException(401, tr("Konto ist deaktiviert."))
        if body.display_name is not None:
            if record.identity:
                raise HTTPException(
                    422, tr("Der Anzeigename dieses Kontos wird extern verwaltet.")
                )
            record.display_name = body.display_name
        preference = db.get(UserPreference, user.id)
        if preference is None:
            preference = UserPreference(user_id=user.id)
            db.add(preference)
        preference.language = body.language
        audit(db, record, "profile_updated", record.id)
        db.commit()
        return profile_json(db, record)
