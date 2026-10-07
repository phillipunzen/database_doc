"""Structural evidence and DWH preparation, using stored snapshots only."""

import re
from datetime import timedelta
from sqlalchemy import select
from .models import Snapshot, SourceAnalysis, now
from .connectors import table_key
from .i18n import tr


def latest(db, source_id):
    return db.scalar(
        select(Snapshot)
        .where(Snapshot.source_id == source_id)
        .order_by(Snapshot.id.desc())
        .limit(1)
    )


def family(data_type):
    value = data_type.lower()
    if any(t in value for t in ("date", "time")):
        return "time"
    if any(t in value for t in ("int", "serial")):
        return "integer"
    if any(
        t in value for t in ("decimal", "numeric", "float", "double", "real", "money")
    ):
        return "number"
    if any(t in value for t in ("char", "text", "string", "uuid", "objectid")):
        return "text"
    if "bool" in value or value == "bit":
        return "boolean"
    return "other"


def settings(db, source_id):
    row = db.get(SourceAnalysis, source_id)
    return {
        "version": row.version if row else 1,
        "tables": row.content.get("tables", {}) if row else {},
        "rules": row.content.get("rules", []) if row else [],
    }


def report(db, source):
    snap = latest(db, source.id)
    config = settings(db, source.id)
    tables = snap.payload.get("tables", []) if snap else []
    known = {t["key"]: t for t in tables}
    incoming = {key: [] for key in known}
    for t in tables:
        for fk in t.get("foreign_keys", []):
            target = table_key(fk.get("target_schema") or "", fk["target_table"])
            if target in incoming:
                incoming[target].append(
                    {
                        "table_key": t["key"],
                        "name": t["name"],
                        "schema": t.get("schema", ""),
                        "kind": "foreign_key",
                    }
                )
        for dep in t.get("dependencies", []):
            target = table_key(dep.get("schema") or "", dep["name"])
            if target in incoming:
                incoming[target].append(
                    {
                        "table_key": t["key"],
                        "name": t["name"],
                        "schema": t.get("schema", ""),
                        "kind": "view_dependency",
                    }
                )
    findings, result = [], []

    def hint(code, message, t=None, severity="info", column=None):
        findings.append(
            {
                "code": code,
                "severity": severity,
                "message": tr(message),
                "table_key": t["key"] if t else None,
                "column": column,
            }
        )

    if not snap:
        hint(
            "scan_missing",
            "Noch kein Struktur-Scan vorhanden. Zuerst die Datenquelle scannen.",
            severity="warning",
        )
    elif snap.created < now() - timedelta(days=7):
        hint(
            "scan_old",
            "Der Struktur-Scan ist älter als sieben Tage. Vor Entscheidungen aktualisieren.",
            severity="warning",
        )
    for t in tables:
        count_before = len(findings)
        cols = t.get("columns", [])
        keys = {c["name"] for c in cols}
        prep = config["tables"].get(t["key"], {})
        physical = t.get("kind") == "table"
        if physical and not t.get("primary_key"):
            hint(
                "key_missing",
                "Kein deklarierter Primärschlüssel. Eindeutige Identifikation fachlich prüfen.",
                t,
                "warning",
            )
        if not t.get("foreign_keys") and not incoming[t["key"]] and physical:
            hint(
                "isolated",
                "Keine deklarierten Tabellenbeziehungen. Mögliche fachliche Beziehungen dokumentieren.",
                t,
            )
        if not prep.get("grain"):
            hint(
                "grain_missing",
                "Zeilenbedeutung für das DWH noch nicht dokumentiert.",
                t,
            )
        if not prep.get("delete_strategy"):
            hint(
                "deletes_missing",
                "Löschbehandlung noch offen: Wie werden entfernte Quelldaten im DWH erkannt?",
                t,
            )
        change_candidates = [
            c["name"]
            for c in cols
            if family(c.get("type", "")) == "time"
            and re.search(
                r"updated|modified|changed|geaendert|geändert|timestamp",
                c["name"],
                re.I,
            )
        ]
        if not prep.get("change_column") and prep.get("load_mode") != "full":
            hint(
                "change_missing",
                "Änderungserkennung noch offen. Zeitspalten sind Kandidaten und müssen fachlich geprüft werden.",
                t,
            )
        elif prep.get("change_column") and prep["change_column"] not in keys:
            hint(
                "change_removed",
                "Die dokumentierte Änderungsspalte fehlt im aktuellen Scan.",
                t,
                "warning",
                prep["change_column"],
            )
        for c in cols:
            if family(c.get("type", "")) == "other":
                hint(
                    "special_type",
                    "Spezialdatentyp: Übertragung und Zieltyp für das DWH prüfen.",
                    t,
                    column=c["name"],
                )
        pk = t.get("primary_key", [])
        for fk in t.get("foreign_keys", []):
            indexed = (
                [pk]
                + [idx.get("columns", []) for idx in t.get("indexes", [])]
                + [idx.get("columns", []) for idx in t.get("unique_constraints", [])]
            )
            if not any(i[: len(fk["columns"])] == fk["columns"] for i in indexed):
                hint(
                    "fk_index",
                    "Kein passender Indexanfang für einen Fremdschlüssel dokumentiert. Nutzen vor einer Änderung prüfen.",
                    t,
                )
        readiness = {
            "declared_key": bool(pk),
            "grain": bool(prep.get("grain")),
            "change_detection": bool(
                (
                    prep.get("load_mode") == "incremental"
                    and prep.get("change_column") in keys
                )
                or prep.get("load_mode") == "full"
            ),
            "delete_strategy": bool(prep.get("delete_strategy")),
        }
        result.append(
            {
                "table_key": t["key"],
                "name": t["name"],
                "schema": t.get("schema", ""),
                "kind": t.get("kind", "table"),
                "columns": cols,
                "primary_key": pk,
                "estimated_rows": t.get("estimated_rows"),
                "size_bytes": t.get("size_bytes"),
                "stats_origin": t.get("stats_origin"),
                "dependencies": t.get("dependencies", []),
                "dependency_status": t.get("dependency_status", "not_scanned"),
                "foreign_keys": t.get("foreign_keys", []),
                "used_by": incoming[t["key"]],
                "preparation": prep,
                "change_candidates": change_candidates,
                "readiness": readiness,
                "finding_count": len(findings) - count_before,
            }
        )
    return {
        "source_id": source.id,
        "snapshot_id": snap.id if snap else None,
        "scanned_at": snap.created if snap else None,
        "settings": config,
        "tables": result,
        "findings": findings,
        "counts": {
            "objects": len(tables),
            "warnings": sum(f["severity"] == "warning" for f in findings),
            "hints": sum(f["severity"] == "info" for f in findings),
        },
        "scan_warnings": snap.payload.get("warnings", []) if snap else [],
    }
