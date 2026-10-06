"""Request-scoped localization of application text, never of user-authored data."""

import json
import re
from contextvars import ContextVar
from pathlib import Path

MESSAGES = json.loads((Path(__file__).parent / "static/translations.json").read_text())
LANGUAGE = ContextVar("databasedoc_language", default="de")


def negotiate_language(header):
    preferences = []
    for order, entry in enumerate((header or "").split(",")):
        parts = entry.strip().split(";")
        try:
            quality = next(
                (float(p.strip()[2:]) for p in parts[1:] if p.strip().startswith("q=")),
                1,
            )
        except ValueError:
            continue
        if 0 < quality <= 1:
            preferences.append((-quality, order, parts[0].lower().split("-")[0]))
    return next(
        (lang for _, _, lang in sorted(preferences) if lang in {"de", "en"}), "en"
    )


def tr(message, *values):
    translated = MESSAGES.get(message, message) if LANGUAGE.get() == "en" else message
    return (
        re.sub(r"\{(\d+)\}", lambda m: str(values[int(m[1])]), translated)
        if values
        else translated
    )


MESSAGE_PATTERNS = [
    (
        key,
        re.compile(
            "^"
            + "([\\s\\S]*?)".join(re.escape(part) for part in re.split(r"\{\d+\}", key))
            + "$"
        ),
    )
    for key in MESSAGES
    if re.search(r"\{\d+\}", key)
]


def tr_message(message):
    """Translate persisted generated messages; never pass notes or row values here."""
    if LANGUAGE.get() != "en" or not isinstance(message, str):
        return message
    if message in MESSAGES:
        return tr(message)
    for key, pattern in MESSAGE_PATTERNS:
        match = pattern.match(message)
        if match:
            return tr(key, *match.groups())
    return message
