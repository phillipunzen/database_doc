"""Optional catalog-only size estimates and declared view dependencies."""

from sqlalchemy import text
from .connectors import table_key
from .i18n import tr


def enrich(kind, conn, tables):
    known = {t["key"]: t for t in tables}
    warnings = []
    for t in tables:
        t["dependencies"] = []
        t["dependency_status"] = "unavailable"
    stats_sql = {
        "postgresql": "SELECT n.nspname AS schema_name,c.relname AS object_name,c.reltuples AS estimated_rows,pg_total_relation_size(c.oid) AS size_bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND has_table_privilege(c.oid,'SELECT')",
        "mysql": "SELECT TABLE_SCHEMA AS schema_name,TABLE_NAME AS object_name,TABLE_ROWS AS estimated_rows,DATA_LENGTH+INDEX_LENGTH AS size_bytes FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'",
        "mariadb": "SELECT TABLE_SCHEMA AS schema_name,TABLE_NAME AS object_name,TABLE_ROWS AS estimated_rows,DATA_LENGTH+INDEX_LENGTH AS size_bytes FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'",
        "mssql": "SELECT s.name AS schema_name,t.name AS object_name,SUM(p.rows) AS estimated_rows FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1) GROUP BY s.name,t.name",
    }
    deps_sql = {
        "postgresql": "SELECT DISTINCT ns.nspname AS source_schema,v.relname AS source_name,nt.nspname AS target_schema,t.relname AS target_name FROM pg_rewrite r JOIN pg_class v ON v.oid=r.ev_class JOIN pg_namespace ns ON ns.oid=v.relnamespace JOIN pg_depend d ON d.classid='pg_rewrite'::regclass AND d.objid=r.oid AND d.refclassid='pg_class'::regclass JOIN pg_class t ON t.oid=d.refobjid JOIN pg_namespace nt ON nt.oid=t.relnamespace WHERE v.relkind='v' AND t.relkind IN ('r','p','v') AND v.oid<>t.oid AND has_table_privilege(v.oid,'SELECT') AND has_table_privilege(t.oid,'SELECT')",
        "mssql": "SELECT DISTINCT ss.name AS source_schema,v.name AS source_name,ts.name AS target_schema,t.name AS target_name FROM sys.sql_expression_dependencies d JOIN sys.views v ON v.object_id=d.referencing_id JOIN sys.schemas ss ON ss.schema_id=v.schema_id JOIN sys.objects t ON t.object_id=d.referenced_id JOIN sys.schemas ts ON ts.schema_id=t.schema_id WHERE t.type IN ('U','V') AND d.referenced_database_name IS NULL AND d.referenced_server_name IS NULL",
        "mysql": "SELECT VIEW_SCHEMA AS source_schema,VIEW_NAME AS source_name,TABLE_SCHEMA AS target_schema,TABLE_NAME AS target_name FROM information_schema.VIEW_TABLE_USAGE WHERE VIEW_SCHEMA=DATABASE() AND TABLE_SCHEMA=DATABASE()",
    }

    def read(sql):
        # An optional catalog failure must not abort PostgreSQL's outer transaction.
        if kind == "postgresql":
            with conn.begin_nested():
                return list(conn.execute(text(sql)).mappings())
        return list(conn.execute(text(sql)).mappings())

    if kind in stats_sql:
        try:
            for row in read(stats_sql[kind]):
                t = known.get(table_key(row["schema_name"], row["object_name"]))
                if t:
                    value = row.get("estimated_rows")
                    t["estimated_rows"] = (
                        int(value) if value is not None and value >= 0 else None
                    )
                    t["size_bytes"] = (
                        int(row["size_bytes"])
                        if row.get("size_bytes") is not None
                        else None
                    )
                    t["stats_origin"] = "catalog_estimate"
        except Exception:
            warnings.append(
                tr(
                    "Optionale Größenstatistiken nicht verfügbar. Der Struktur-Scan ist vollständig; Katalogrechte oder Datenbankversion prüfen."
                )
            )
    if kind in deps_sql:
        try:
            rows = read(deps_sql[kind])
            for t in tables:
                t["dependency_status"] = "catalog"
            for row in rows:
                t = known.get(table_key(row["source_schema"], row["source_name"]))
                target = known.get(table_key(row["target_schema"], row["target_name"]))
                # This inventory deliberately stays within the scanned scope.
                if t and target:
                    t["dependencies"].append(
                        {
                            "schema": row["target_schema"],
                            "name": row["target_name"],
                            "table_key": target["key"],
                            "kind": "view",
                        }
                    )
        except Exception:
            warnings.append(
                tr(
                    "Optionale View-Abhängigkeiten nicht verfügbar. Katalogrechte oder Datenbankversion prüfen."
                )
            )
    return warnings
