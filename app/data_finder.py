"""Local vocabulary and permission-filtered metadata suggestions; no row queries."""

import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from sqlalchemy import select
from .models import Note, BusinessConcept
from .business_catalog import visible_sources, source_ids
from .source_analysis import latest
from .analysis_api import data_allowed
from .connectors import table_key
from .i18n import tr
from .security import decrypt

VOCABULARY = {
    "customer": (
        "Kunden",
        [
            "customer",
            "customers",
            "client",
            "clients",
            "kunde",
            "kunden",
            "debitor",
            "debitoren",
        ],
    ),
    "address": (
        "Adressen",
        [
            "address",
            "addresses",
            "adresse",
            "adressen",
            "anschrift",
            "street",
            "strasse",
            "straße",
            "postal",
            "postcode",
            "zipcode",
            "zip_code",
            "postleitzahl",
            "plz",
            "city",
            "wohnort",
            "ort",
            "country",
            "land",
            "house_number",
            "hausnummer",
        ],
    ),
    "supplier": (
        "Lieferanten",
        [
            "supplier",
            "suppliers",
            "vendor",
            "vendors",
            "lieferant",
            "lieferanten",
            "kreditor",
            "kreditoren",
        ],
    ),
    "order": (
        "Bestellungen",
        [
            "order",
            "orders",
            "auftrag",
            "auftraege",
            "aufträge",
            "bestellung",
            "bestellungen",
        ],
    ),
    "invoice": (
        "Rechnungen",
        ["invoice", "invoices", "rechnung", "rechnungen", "faktura"],
    ),
    "machine": ("Maschinen", ["machine", "machines", "maschine", "maschinen"]),
    "product": (
        "Artikel",
        ["product", "products", "article", "articles", "artikel", "material"],
    ),
    "employee": (
        "Mitarbeiter",
        ["employee", "employees", "mitarbeiter", "personal", "staff"],
    ),
    "measurement": (
        "Messdaten",
        [
            "measurement",
            "measurements",
            "sensor",
            "telemetry",
            "messwert",
            "messwerte",
            "messdaten",
        ],
    ),
    "inventory": (
        "Lagerbestand",
        ["inventory", "stock", "lagerbestand", "bestand", "warehouse_stock"],
    ),
    "sales": ("Umsatz", ["sales", "revenue", "umsatz", "verkauf", "verkaeufe"]),
    "email": ("E-Mail", ["email", "e_mail", "mailadresse", "emailadresse"]),
    "phone": (
        "Telefon",
        ["phone", "telephone", "telefon", "telefonnummer", "mobile", "mobilnummer"],
    ),
}
STOP = {
    "wo",
    "finde",
    "findet",
    "ich",
    "man",
    "die",
    "der",
    "das",
    "den",
    "dem",
    "des",
    "von",
    "zu",
    "im",
    "in",
    "welcher",
    "welche",
    "welchen",
    "datenbank",
    "tabelle",
    "tabellen",
    "suche",
    "sucht",
    "such",
    "suchen",
    "bitte",
    "und",
    "oder",
    "where",
    "find",
    "can",
    "i",
    "the",
    "a",
    "an",
    "of",
    "for",
    "in",
    "which",
    "table",
    "tables",
    "database",
    "data",
    "and",
    "or",
    "are",
    "is",
    "stored",
    "daten",
    "mit",
}


def words(value):
    value = re.sub(r"([a-zäöü])([A-ZÄÖÜ])", r"\1 \2", str(value))
    value = (
        unicodedata.normalize("NFKC", value)
        .casefold()
        .replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
    )
    return re.findall(r"[a-z0-9]+", value)


ALIASES = {
    key: {"".join(words(a)) for a in aliases}
    for key, (_, aliases) in VOCABULARY.items()
}


def groups(value):
    tokens = words(value)
    joined = "".join(tokens)
    return {
        key
        for key, aliases in ALIASES.items()
        if any(
            (alias_norm in tokens or (len(alias_norm) >= 5 and alias_norm in joined))
            for alias_norm in aliases
        )
    }


def text_field(column, kind):
    dtype = column.get("type", "").lower()
    if kind == "mongodb":
        return "str" in re.split(r"\s*\|\s*", dtype) and all(
            p and not p.startswith("$") for p in column["name"].split(".")
        )
    return (
        any(t in dtype for t in ["char", "text", "clob", "citext"])
        and "binary" not in dtype
    )


def candidates(db, user, query, value_hint, selected_sources, page, page_size):
    sources = visible_sources(db, user)
    visible_ids = {s.id for s in sources}
    if selected_sources:
        sources = [s for s in sources if s.id in set(selected_sources)]
    facets = groups(query)
    if not query.strip() and value_hint:
        lower = "".join(words(value_hint))
        if "@" in value_hint:
            facets = {"email"}
        elif any(s in lower for s in ["strasse", "street", "avenue", "road", "gasse"]):
            facets = {"address"}
    tokens = [w for w in words(query) if w not in STOP]
    mapped = defaultdict(list)
    for concept in db.scalars(select(BusinessConcept)):
        if source_ids(concept.content) <= visible_ids:
            for b in concept.content["bindings"]:
                mapped[(b["source_id"], b["table_key"])].append(concept.content)
    hits = []
    unscanned = 0
    for source in sources:
        snap = latest(db, source.id)
        if not snap:
            unscanned += 1
            continue
        cfg = decrypt(source)
        database_name = cfg.get("database") or Path(cfg.get("path", "")).name
        tables = snap.payload["tables"]
        neighbors = defaultdict(list)
        by_key = {t["key"]: t for t in tables}
        for t in tables:
            for fk in t.get("foreign_keys", []):
                key = table_key(
                    fk.get("target_schema") or t.get("schema") or "", fk["target_table"]
                )
                if key in by_key:
                    neighbors[t["key"]].append(by_key[key]["name"])
                    neighbors[key].append(t["name"])
        notes = {
            n.table_key: n.text
            for n in db.scalars(select(Note).where(Note.source_id == source.id))
        }
        for t in tables:
            concepts = mapped[(source.id, t["key"])]
            own = " ".join(
                [t["name"], t.get("comment") or "", notes.get(t["key"], "")]
                + [c["name"] + " " + (c.get("comment") or "") for c in t["columns"]]
                + [c["name"] + " " + c.get("definition", "") for c in concepts]
            )
            direct = groups(own)
            related = groups(" ".join(neighbors[t["key"]]))
            direct_hits = facets & direct
            relation_hits = (facets - direct) & related
            if facets:
                if not direct_hits:
                    continue
                score = len(direct_hits) * 100 + len(relation_hits) * 25
            elif tokens:
                text = " ".join(words(own + " " + source.name))
                if not all(word in text for word in tokens):
                    continue
                score = 50
            else:
                score = 1
            columns = []
            for c in t["columns"]:
                cg = groups(c["name"] + " " + (c.get("comment") or "")) & facets
                for concept in concepts:
                    if any(
                        b["source_id"] == source.id
                        and b["table_key"] == t["key"]
                        and b["column"] == c["name"]
                        for b in concept["bindings"]
                    ):
                        cg |= (
                            groups(
                                concept["name"] + " " + concept.get("definition", "")
                            )
                            & facets
                        )
                columns.append(
                    {
                        "name": c["name"],
                        "type": c.get("type", ""),
                        "searchable": text_field(c, source.kind),
                        "matched": bool(cg),
                    }
                )
            columns.sort(key=lambda c: (not c["matched"], c["name"].casefold()))
            default = [c["name"] for c in columns if c["searchable"] and c["matched"]][
                :3
            ]
            if not default:
                default = [c["name"] for c in columns if c["searchable"]][:3]
            hits.append(
                {
                    "source_id": source.id,
                    "source_name": source.name,
                    "database_name": database_name,
                    "kind": source.kind,
                    "snapshot_id": snap.id,
                    "table_key": t["key"],
                    "table_name": t["name"],
                    "schema": t.get("schema") or "",
                    "score": score,
                    "matched_terms": (
                        [tr(VOCABULARY[k][0]) for k in sorted(direct_hits)]
                        if facets
                        else []
                    ),
                    "related_terms": (
                        [tr(VOCABULARY[k][0]) for k in sorted(relation_hits)]
                        if facets
                        else []
                    ),
                    "inferred_categories": [
                        tr(VOCABULARY[k][0]) for k in sorted(direct)
                    ],
                    "suggested_role": (
                        "fact"
                        if direct & {"order", "invoice", "measurement", "sales"}
                        else (
                            "dimension"
                            if direct
                            & {"customer", "supplier", "product", "employee", "address"}
                            else None
                        )
                    ),
                    "related_tables": sorted(set(neighbors[t["key"]])),
                    "concepts": [c["name"] for c in concepts],
                    "columns": columns,
                    "default_columns": default,
                    "can_data": data_allowed(db, user, source.id),
                }
            )
    hits.sort(
        key=lambda h: (
            -h["score"],
            h["source_name"].casefold(),
            h["schema"].casefold(),
            h["table_name"].casefold(),
        )
    )
    return {
        "recognized_terms": [tr(VOCABULARY[k][0]) for k in sorted(facets)],
        "total": len(hits),
        "page": page,
        "page_size": page_size,
        "unscanned_sources": unscanned,
        "candidates": hits[(page - 1) * page_size : page * page_size],
    }
