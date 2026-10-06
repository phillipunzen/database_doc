"""Read-only metadata adapters. Never accepts SQL from the browser."""

import json
import os
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote
from sqlalchemy import create_engine, inspect, MetaData, Table, select, text, event
from sqlalchemy.engine import URL
from sqlalchemy.pool import NullPool
from pymongo import MongoClient

KINDS = {"mssql", "mysql", "mariadb", "postgresql", "mongodb", "sqlite"}
SYSTEM_SCHEMAS = {
    "information_schema",
    "pg_catalog",
    "sys",
    "mysql",
    "performance_schema",
}


class ConnectorError(Exception):
    pass


def validate_config(kind, config):
    if kind not in KINDS:
        raise ValueError("Nicht unterstützter Datenbanktyp.")
    if kind == "sqlite":
        sqlite_path(config)
        return
    if not config.get("host") or not config.get("database"):
        raise ValueError("Host und Datenbank sind erforderlich.")
    if (
        not 1
        <= int(
            config.get("port")
            or {
                "mssql": 1433,
                "mysql": 3306,
                "mariadb": 3306,
                "postgresql": 5432,
                "mongodb": 27017,
            }[kind]
        )
        <= 65535
    ):
        raise ValueError("Ungültiger Port.")
    if len(config.get("host", "")) > 253 or any(c in config["host"] for c in "/;?@"):
        raise ValueError("Ungültiger Hostname.")


def sqlite_path(config):
    root = Path(os.getenv("SQLITE_ROOT", "/sources")).resolve()
    path = Path(config.get("path", "")).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError(
            "SQLite-Datei muss innerhalb des freigegebenen sources-Verzeichnisses liegen."
        )
    return path


@contextmanager
def relational(kind, cfg):
    if kind == "sqlite":
        path = sqlite_path(cfg)
        url = f'sqlite:///file:{quote(str(path), safe="/")}?mode=ro&uri=true'
        args = {"timeout": 10}
    else:
        driver = {
            "mssql": "mssql+pyodbc",
            "mysql": "mysql+pymysql",
            "mariadb": "mysql+pymysql",
            "postgresql": "postgresql+psycopg",
        }[kind]
        query = {}
        tls = cfg.get("tls", True)
        if kind == "mssql":
            query = {
                "driver": "ODBC Driver 18 for SQL Server",
                "Encrypt": "yes" if tls else "no",
                "TrustServerCertificate": "no",
            }
            args = {"timeout": 10}
        elif kind == "postgresql":
            query = {
                "sslmode": "verify-full" if tls else "disable",
                "connect_timeout": "10",
                "options": "-c statement_timeout=15000 -c default_transaction_read_only=on",
            }
            if tls:
                query["sslrootcert"] = os.getenv("SOURCE_CA_FILE") or "system"
            args = {}
        else:
            args = {"connect_timeout": 10, "read_timeout": 15, "write_timeout": 15}
            if tls:
                args["ssl"] = {"check_hostname": True}
                if os.getenv("SOURCE_CA_FILE"):
                    args["ssl"]["ca"] = os.environ["SOURCE_CA_FILE"]
        url = URL.create(
            driver,
            username=cfg.get("username"),
            password=cfg.get("password"),
            host=cfg["host"],
            port=int(
                cfg.get("port")
                or {"mssql": 1433, "mysql": 3306, "mariadb": 3306, "postgresql": 5432}[
                    kind
                ]
            ),
            database=cfg["database"],
            query=query,
        )
    engine = create_engine(url, connect_args=args, poolclass=NullPool)
    if kind == "mssql":

        @event.listens_for(engine, "connect")
        def set_query_timeout(dbapi_connection, _):
            dbapi_connection.timeout = 15

    try:
        with engine.connect() as conn:
            if kind in {"mysql", "mariadb"}:
                conn.execute(text("SET SESSION TRANSACTION READ ONLY"))
                conn.commit()
            yield conn
    finally:
        engine.dispose()


@contextmanager
def mongo(cfg):
    tls_args = (
        {"tlsCAFile": os.environ["SOURCE_CA_FILE"]}
        if cfg.get("tls", True) and os.getenv("SOURCE_CA_FILE")
        else {}
    )
    client = MongoClient(
        **tls_args,
        host=cfg["host"],
        port=int(cfg.get("port") or 27017),
        username=cfg.get("username") or None,
        password=cfg.get("password") or None,
        authSource=cfg.get("auth_source") or cfg["database"],
        tls=cfg.get("tls", True),
        serverSelectionTimeoutMS=10000,
        connectTimeoutMS=10000,
        socketTimeoutMS=15000,
    )
    try:
        yield client[cfg["database"]]
    finally:
        client.close()


def connection_test(kind, cfg):
    validate_config(kind, cfg)
    if kind == "mongodb":
        with mongo(cfg) as db:
            db.command("ping")
    else:
        with relational(kind, cfg) as conn:
            conn.execute(text("SELECT 1"))


def table_key(schema, name):
    return json.dumps([schema or "", name], ensure_ascii=False, separators=(",", ":"))


def documented_type(value, dialect=None):
    rendered = (
        str(value.compile(dialect=dialect)) if dialect is not None else str(value)
    )
    # MySQL/MariaDB's generic compiler omits display width and unsigned flags.
    # Retain these scanned attributes for BOOLEAN aliases and portable range planning.
    width = getattr(value, "display_width", None)
    if type(value).__name__ == "TINYINT" and width is not None and "(" not in rendered:
        rendered += f"({int(width)})"
    if getattr(value, "unsigned", False) and "UNSIGNED" not in rendered.upper():
        rendered += " UNSIGNED"
    return rendered


def optional(fn, fallback):
    try:
        return fn()
    except NotImplementedError:
        return fallback


def scan(kind, cfg, infer=False):
    if kind == "mongodb":
        return scan_mongo(cfg, infer)
    tables = []
    with relational(kind, cfg) as conn:
        inspector = inspect(conn)
        if kind == "sqlite":
            schemas = [None]
        elif cfg.get("schema"):
            schemas = [cfg["schema"]]
        elif kind in {"mysql", "mariadb"}:
            schemas = [cfg["database"]]
        else:
            schemas = [
                s
                for s in inspector.get_schema_names()
                if s.lower() not in SYSTEM_SCHEMAS and not s.startswith("pg_")
            ]
        for schema in schemas:
            names = [(n, "table") for n in inspector.get_table_names(schema=schema)]
            names += [(n, "view") for n in inspector.get_view_names(schema=schema)]
            for name, object_type in names:
                if len(tables) >= 2000:
                    raise ConnectorError(
                        "Scan-Limit von 2.000 Objekten erreicht. Bitte ein einzelnes Schema auswählen."
                    )
                columns = inspector.get_columns(name, schema=schema)
                pk = optional(
                    lambda: inspector.get_pk_constraint(name, schema=schema), {}
                ).get("constrained_columns", [])
                fks = optional(
                    lambda: inspector.get_foreign_keys(name, schema=schema), []
                )
                indexes = optional(
                    lambda: inspector.get_indexes(name, schema=schema), []
                )
                uniques = optional(
                    lambda: inspector.get_unique_constraints(name, schema=schema), []
                )
                comment = optional(
                    lambda: inspector.get_table_comment(name, schema=schema), {}
                ).get("text")
                tables.append(
                    {
                        "key": table_key(schema, name),
                        "schema": schema or "",
                        "name": name,
                        "kind": object_type,
                        "comment": comment,
                        "columns": [
                            {
                                "name": c["name"],
                                "type": documented_type(c["type"], conn.dialect),
                                "nullable": bool(c.get("nullable", True)),
                                "default": (
                                    str(c["default"])
                                    if c.get("default") is not None
                                    else None
                                ),
                                "comment": c.get("comment"),
                                "primary_key": c["name"] in pk,
                            }
                            for c in columns
                        ],
                        "primary_key": pk,
                        "foreign_keys": [
                            {
                                "name": f.get("name"),
                                "columns": f["constrained_columns"],
                                "target_schema": f.get("referred_schema")
                                or schema
                                or "",
                                "target_table": f["referred_table"],
                                "target_columns": f["referred_columns"],
                            }
                            for f in fks
                        ],
                        "indexes": [
                            {
                                "name": i.get("name"),
                                "columns": i.get("column_names", []),
                                "unique": bool(i.get("unique")),
                            }
                            for i in indexes
                        ],
                        "unique_constraints": [
                            {
                                "name": u.get("name"),
                                "columns": u.get("column_names", []),
                            }
                            for u in uniques
                        ],
                    }
                )
    return {"kind": kind, "tables": tables, "warnings": [], "inferred": False}


def scan_mongo(cfg, infer):
    tables = []
    with mongo(cfg) as db:
        infos = list(db.list_collections())
        if len(infos) > 2000:
            raise ConnectorError("Scan-Limit von 2.000 Collections erreicht.")
        for info in infos:
            name = info["name"]
            fields = {}
            observed = 0
            if infer and info.get("type") != "view":
                for doc in db[name].find({}, max_time_ms=15000).limit(100):
                    observed += 1

                    def visit(obj, prefix=""):
                        for key, value in obj.items():
                            field = prefix + key
                            fields.setdefault(field, {"types": set(), "count": 0})
                            fields[field]["types"].add(type(value).__name__)
                            fields[field]["count"] += 1
                            if isinstance(value, dict) and field.count(".") < 5:
                                visit(value, field + ".")

                    visit(doc)
            idx = list(db[name].list_indexes()) if info.get("type") != "view" else []
            tables.append(
                {
                    "key": table_key(cfg["database"], name),
                    "schema": cfg["database"],
                    "name": name,
                    "kind": "collection" if info.get("type") != "view" else "view",
                    "comment": None,
                    "columns": [
                        {
                            "name": f,
                            "type": " | ".join(sorted(v["types"])),
                            "nullable": v["count"] < observed
                            or "NoneType" in v["types"],
                            "default": None,
                            "comment": None,
                            "primary_key": f == "_id",
                        }
                        for f, v in fields.items()
                    ],
                    "primary_key": ["_id"],
                    "foreign_keys": [],
                    "indexes": [
                        {
                            "name": i["name"],
                            "columns": list(i["key"]),
                            "unique": i.get("unique", False),
                        }
                        for i in idx
                    ],
                    "unique_constraints": [],
                    "validator": json.loads(
                        json.dumps(
                            info.get("options", {}).get("validator"), default=str
                        )
                    ),
                    "sampled_documents": observed,
                }
            )
    return {
        "kind": "mongodb",
        "tables": tables,
        "warnings": [
            (
                "MongoDB-Felder werden aus maximal 100 Dokumenten pro Collection abgeleitet; dies ist kein vollständiges Schema. Dokumentwerte werden nicht gespeichert."
                if infer
                else "Feldableitung ist deaktiviert. Es werden nur Collections, Indizes und Validatoren dokumentiert."
            )
        ],
        "inferred": infer,
    }


def safe_value(value):
    if value is None or isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, bytes):
        return f"[Binärdaten: {len(value)} Bytes]"
    rendered = (
        json.dumps(value, default=str, ensure_ascii=False)
        if isinstance(value, (dict, list))
        else str(value)
    )
    return rendered[:2000] + ("…" if len(rendered) > 2000 else "")


def preview(kind, cfg, table):
    if kind == "mongodb":
        with mongo(cfg) as db:
            rows = list(db[table["name"]].find({}, max_time_ms=15000).limit(50))
            columns = list(dict.fromkeys(k for row in rows for k in row))
            return {
                "columns": columns,
                "rows": [[safe_value(row.get(c)) for c in columns] for row in rows],
                "limit": 50,
            }
    with relational(kind, cfg) as conn:
        # Use names from the stored snapshot, quoted by SQLAlchemy, never browser SQL.
        obj = Table(
            table["name"],
            MetaData(),
            schema=table["schema"] or None,
            autoload_with=conn,
        )
        result = conn.execute(select(obj).limit(50))
        return {
            "columns": list(result.keys()),
            "rows": [[safe_value(v) for v in row] for row in result],
            "limit": 50,
        }


def discover_databases(kind, cfg):
    cfg = dict(cfg)
    if kind == "sqlite":
        return [str(sqlite_path(cfg))]
    cfg["database"] = (
        cfg.get("database")
        or {
            "mssql": "master",
            "mysql": "information_schema",
            "mariadb": "information_schema",
            "postgresql": "postgres",
            "mongodb": "admin",
        }[kind]
    )
    validate_config(kind, cfg)
    if kind == "mongodb":
        with mongo(cfg) as db:
            return [
                n
                for n in db.client.list_database_names()
                if n not in {"admin", "config", "local"}
            ]
    with relational(kind, cfg) as conn:
        if kind in {"mysql", "mariadb"}:
            return [
                row[0]
                for row in conn.execute(text("SHOW DATABASES"))
                if row[0] not in SYSTEM_SCHEMAS
            ]
        if kind == "postgresql":
            return [
                row[0]
                for row in conn.execute(
                    text(
                        "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate AND has_database_privilege(datname, 'CONNECT') ORDER BY datname"
                    )
                )
            ]
        return [
            row[0]
            for row in conn.execute(
                text(
                    "SELECT name FROM sys.databases WHERE state=0 AND HAS_DBACCESS(name)=1 AND name NOT IN ('master','tempdb','model','msdb') ORDER BY name"
                )
            )
        ]
