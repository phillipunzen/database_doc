"""Evidence-based warehouse inventory and advice from authorized, stored schema scans."""

from datetime import timedelta
from sqlalchemy import select

from .i18n import tr
from .models import Source, Grant, Snapshot, Job, now
from .security import decrypt
from .schema_diff import compare
from .warehouse import compare_target

STALE_DAYS = 7
DEFAULT_PORTS = {"mssql": 1433, "postgresql": 5432, "mariadb": 3306}


def assessment(db, user, project):
    # Import at call time to keep the project router independent of this report.
    from .warehouse_api import as_input, latest

    body = as_input(db, project)
    generated = now()
    findings = []

    def hint(code, severity, message, action="", source_id=None, table_id=None):
        findings.append(
            {
                "code": code,
                "severity": severity,
                "message": message,
                "action": action,
                "source_id": source_id,
                "table_id": str(table_id) if table_id else None,
            }
        )

    def summary(source):
        config = decrypt(source)
        snap = latest(db, source.id)
        grant = db.scalar(
            select(Grant).where(Grant.source_id == source.id, Grant.user_id == user.id)
        )
        job = db.scalar(
            select(Job)
            .where(Job.source_id == source.id)
            .order_by(Job.id.desc())
            .limit(1)
        )
        tables = snap.payload.get("tables", []) if snap else []
        result = {
            "id": source.id,
            "name": source.name,
            "kind": source.kind,
            "host": config.get("host", ""),
            "port": config.get("port") or DEFAULT_PORTS.get(source.kind),
            "database": config.get("database", ""),
            "schema_filter": config.get("schema", ""),
            "snapshot_id": snap.id if snap else None,
            "scanned_at": snap.created if snap else None,
            "stale": bool(
                snap and snap.created < generated - timedelta(days=STALE_DAYS)
            ),
            "can_scan": user.role == "admin"
            or bool(user.role == "editor" and grant and grant.edit),
            "object_count": len(tables),
            "table_count": sum(t.get("kind") == "table" for t in tables),
            "view_count": sum(t.get("kind") == "view" for t in tables),
            "column_count": sum(len(t.get("columns", [])) for t in tables),
            "relation_count": sum(len(t.get("foreign_keys", [])) for t in tables),
            "warnings": snap.payload.get("warnings", []) if snap else [],
            "job": {"status": job.status, "message": job.message} if job else None,
        }
        return result, snap

    def scan_hints(info):
        if not info["snapshot_id"]:
            hint(
                "scan_missing",
                "warning",
                tr(
                    "{0}: Noch kein erfolgreicher Struktur-Scan vorhanden.",
                    info["name"],
                ),
                "scan",
                info["id"],
            )
        elif info["stale"]:
            hint(
                "scan_stale",
                "warning",
                tr(
                    "{0}: Der Struktur-Scan ist älter als {1} Tage. Vor Entscheidungen neu scannen.",
                    info["name"],
                    STALE_DAYS,
                ),
                "scan",
                info["id"],
            )
        if info["job"] and info["job"]["status"] == "failed":
            hint(
                "scan_failed",
                "warning",
                tr(
                    "{0}: Der letzte Scan ist fehlgeschlagen; die Prüfung verwendet gegebenenfalls einen älteren erfolgreichen Scan.",
                    info["name"],
                ),
                "source",
                info["id"],
            )
        if info["job"] and info["job"]["status"] in {"queued", "running"}:
            hint(
                "scan_running",
                "info",
                tr(
                    "{0}: Ein Scan läuft oder wartet. Nach Abschluss den Bestand erneut prüfen.",
                    info["name"],
                ),
                "source",
                info["id"],
            )
        for warning in info["warnings"]:
            hint(
                "scan_warning",
                "warning",
                tr("{0}: Scan-Hinweis: {1}", info["name"], warning),
                "source",
                info["id"],
            )

    target = (
        db.get(Source, project.target_source_id) if project.target_source_id else None
    )
    target_info, target_snap, comparison = None, None, None
    inventory, objects, sources = [], [], []
    if not target:
        hint(
            "target_missing",
            "warning",
            tr(
                "DWH-Zieldatenbank verbinden, damit der tatsächliche Bestand mit dem Plan verglichen werden kann."
            ),
            "settings",
        )
    else:
        target_info, target_snap = summary(target)
        scan_hints(target_info)
        if target.kind != project.target_kind:
            hint(
                "target_kind",
                "warning",
                tr("Zieldatenbank und geplante Plattform passen nicht zusammen."),
                "settings",
            )
        else:
            # Only sources explicitly visible to this user enter the server inventory.
            query = select(Source).where(Source.kind == target.kind)
            if user.role != "admin":
                query = query.join(Grant, Grant.source_id == Source.id).where(
                    Grant.user_id == user.id
                )

            def server_key(info):
                return (info["host"].strip().rstrip(".").casefold(), str(info["port"]))

            for source in db.scalars(query.order_by(Source.name, Source.id)):
                config = decrypt(source)
                candidate = {
                    "host": config.get("host", ""),
                    "port": config.get("port") or DEFAULT_PORTS[target.kind],
                }
                if server_key(candidate) == server_key(target_info):
                    info, _ = summary(source)
                    inventory.append(info)
            if target_snap:
                comparison = compare_target(body, target_snap)
                for table in target_snap.payload.get("tables", []):
                    objects.append(
                        {
                            "key": table["key"],
                            "schema": table.get("schema") or "",
                            "name": table["name"],
                            "kind": table.get("kind", "table"),
                            "column_count": len(table.get("columns", [])),
                            "relation_count": len(table.get("foreign_keys", [])),
                            "planned": any(
                                t.name == table["name"]
                                and (table.get("schema") or "") == body.target_schema
                                for t in body.tables
                            ),
                        }
                    )
                for row in comparison["tables"]:
                    for issue in row["issues"]:
                        hint(
                            "target_difference",
                            "warning",
                            tr("{0}: {1}", row["table_name"], issue),
                            "model",
                            target.id,
                            row["table_id"],
                        )
                    if row["extra_columns"]:
                        hint(
                            "target_extra_columns",
                            "info",
                            tr(
                                "{0}: Zusätzliche Felder im DWH: {1}. Prüfe, ob sie im Plan dokumentiert werden sollen.",
                                row["table_name"],
                                ", ".join(row["extra_columns"]),
                            ),
                            "model",
                            target.id,
                            row["table_id"],
                        )
                if comparison["extra_tables"]:
                    hint(
                        "target_extra_tables",
                        "info",
                        tr(
                            "{0} Tabellen im Zielschema sind nicht im Plan enthalten. Vorhandene Strukturen prüfen; nicht automatisch löschen oder übernehmen.",
                            len(comparison["extra_tables"]),
                        ),
                        "source",
                        target.id,
                    )
                if (
                    target_info["schema_filter"]
                    and target_info["schema_filter"] != body.target_schema
                ):
                    hint(
                        "target_scope",
                        "warning",
                        tr(
                            "Der Zielscan ist auf Schema {0} eingeschränkt; das geplante Schema {1} ist damit nicht abgedeckt.",
                            target_info["schema_filter"],
                            body.target_schema,
                        ),
                        "source",
                        target.id,
                    )
    pinned = {}
    latest_by_source = {}
    for source_id in body.source_ids:
        source = db.get(Source, source_id)
        if not source:
            continue
        info, snap = summary(source)
        latest_by_source[source_id] = snap
        scan_hints(info)
        previous = (
            db.scalar(
                select(Snapshot)
                .where(Snapshot.source_id == source_id, Snapshot.id < snap.id)
                .order_by(Snapshot.id.desc())
                .limit(1)
            )
            if snap
            else None
        )
        info["changes"] = None
        if previous:
            delta = compare(previous.payload, snap.payload)
            info["changes"] = {
                "before_snapshot_id": previous.id,
                "before_created": previous.created,
                **delta["summary"],
            }
            if any(delta["summary"].values()):
                hint(
                    "source_changes",
                    "info",
                    tr(
                        "{0}: Seit Scan #{1} wurden {2} Objekte ergänzt, {3} entfernt und {4} verändert. Prüfe die Auswirkungen auf den DWH-Entwurf.",
                        source.name,
                        previous.id,
                        delta["summary"]["added_tables"],
                        delta["summary"]["removed_tables"],
                        delta["summary"]["changed_tables"],
                    ),
                    "compare",
                    source.id,
                )
        sources.append(info)
    for table in body.tables:
        unassigned = 0
        for column in table.columns:
            mapping = column.mapping
            if not mapping:
                if not column.identity and not column.transformation.strip():
                    unassigned += 1
                continue
            snap = latest_by_source.get(mapping.source_id)
            current_table = (
                next(
                    (
                        t
                        for t in snap.payload["tables"]
                        if t["key"] == mapping.table_key
                    ),
                    None,
                )
                if snap
                else None
            )
            current_column = (
                next(
                    (
                        c
                        for c in current_table["columns"]
                        if c["name"] == mapping.column_name
                    ),
                    None,
                )
                if current_table
                else None
            )
            if current_column is None:
                hint(
                    "mapped_field_missing",
                    "warning",
                    tr(
                        "{0}.{1}: Das zugeordnete Quellfeld ist im aktuellen Scan nicht nachgewiesen. Quellscan und Feldzuordnung prüfen.",
                        table.name,
                        column.name,
                    ),
                    "mapping",
                    mapping.source_id,
                    table.id,
                )
                continue
            if mapping.snapshot_id not in pinned:
                pinned[mapping.snapshot_id] = db.get(Snapshot, mapping.snapshot_id)
            original = pinned[mapping.snapshot_id]
            original_table = (
                next(
                    (
                        t
                        for t in original.payload["tables"]
                        if t["key"] == mapping.table_key
                    ),
                    None,
                )
                if original
                else None
            )
            original_column = (
                next(
                    (
                        c
                        for c in original_table["columns"]
                        if c["name"] == mapping.column_name
                    ),
                    None,
                )
                if original_table
                else None
            )
            if not original_column or any(
                current_column.get(k) != original_column.get(k)
                for k in ("type", "nullable", "primary_key")
            ):
                hint(
                    "mapped_field_changed",
                    "warning",
                    tr(
                        "{0}.{1}: Typ, NULL-Zulässigkeit oder Schlüssel des Quellfelds weichen vom zugeordneten Scan #{2} ab. Transformation und Zieltyp prüfen.",
                        table.name,
                        column.name,
                        mapping.snapshot_id,
                    ),
                    "mapping",
                    mapping.source_id,
                    table.id,
                )
        if unassigned:
            hint(
                "mapping_incomplete",
                "info",
                tr(
                    "{0}: Für {1} Felder fehlen Quellzuordnung oder dokumentierte Ableitungsregel.",
                    table.name,
                    unassigned,
                ),
                "mapping",
                table_id=table.id,
            )
    if not body.tables:
        hint(
            "model_missing",
            "info",
            tr(
                "Das Zielmodell ist noch leer. Plane die benötigten Tabellen, bevor ein Soll-Ist-Vergleich möglich ist."
            ),
            "model",
        )
    if not body.source_ids:
        hint(
            "sources_missing",
            "info",
            tr(
                "Noch keine Anwendungsquellen zugeordnet. Wähle die Quellen in den Einstellungen aus, um Änderungen und Feldzuordnungen bewerten zu können."
            ),
            "settings",
        )
    counts = {
        level: sum(f["severity"] == level for f in findings)
        for level in ("warning", "info")
    }
    findings.sort(
        key=lambda f: (
            0 if f["severity"] == "warning" else 1,
            f["code"],
            f["message"].casefold(),
        )
    )
    return {
        "project_id": project.id,
        "project_version": project.version,
        "generated_at": generated,
        "stale_days": STALE_DAYS,
        "target": target_info,
        "server_databases": inventory,
        "target_objects": objects,
        "sources": sources,
        "comparison": comparison,
        "findings": findings[:5000],
        "finding_counts": counts,
        "omitted_findings": max(0, len(findings) - 5000),
        "limitations": tr(
            "Die Prüfung verwendet gespeicherte, berechtigte Struktur-Scans. Serverübersicht: nur eingebundene Datenbanken mit gleichem Datenbanktyp, Host und Port. Datenwerte, Ladejobs, Aktualität der DWH-Daten und fachliche Richtigkeit werden nicht geprüft. Hinweise sind Prüfanlässe, keine automatischen Änderungen."
        ),
    }
