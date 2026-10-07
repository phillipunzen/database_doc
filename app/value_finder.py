"""Explicit, time-limited existence queries on selected scanned text fields."""

import re
import time
from contextlib import contextmanager
from sqlalchemy import Table, Column, MetaData, String, select, literal, text, cast
from sqlalchemy.dialects.mssql import NVARCHAR
from . import connectors
from .db_errors import diagnostic

QUERY_SECONDS = 8
BATCH_SECONDS = 45


def pattern(value, kind):
    escaped = value.replace("!", "!!").replace("%", "!%").replace("_", "!_")
    if kind == "mssql":
        escaped = escaped.replace("[", "![")
    return "%" + escaped + "%"


@contextmanager
def search_connection(kind, cfg):
    manager = (
        connectors.mongo(cfg) if kind == "mongodb" else connectors.relational(kind, cfg)
    )
    with manager as conn:
        yield conn


def exists(kind, conn, table, column, value, mode, timeout):
    if kind == "mongodb":
        match = {
            column: {
                "$type": "string",
                **({"$eq": value} if mode == "exact" else {"$regex": re.escape(value)}),
            }
        }
        return bool(
            list(
                conn[table["name"]].aggregate(
                    [
                        {"$match": match},
                        {"$limit": 1},
                        {"$project": {"_id": 0, "found": {"$literal": 1}}},
                    ],
                    maxTimeMS=max(1, int(timeout * 1000)),
                )
            )
        )
    milliseconds = max(1, int(timeout * 1000))
    if kind == "postgresql":
        conn.execute(
            text("SELECT set_config('statement_timeout',:timeout,true)"),
            {"timeout": str(milliseconds)},
        )
    elif kind == "mariadb":
        conn.execute(
            text("SET SESSION max_statement_time=:seconds"), {"seconds": timeout}
        )
    elif kind == "mysql":
        conn.execute(
            text("SET SESSION max_execution_time=:milliseconds"),
            {"milliseconds": milliseconds},
        )
    elif kind == "mssql":
        conn.connection.driver_connection.timeout = max(1, int(timeout))
    elif kind == "sqlite":
        deadline = time.monotonic() + timeout
        conn.connection.driver_connection.set_progress_handler(
            lambda: int(time.monotonic() >= deadline), 1000
        )
        conn.exec_driver_sql(f"PRAGMA busy_timeout={milliseconds}")
    target = Table(
        table["name"],
        MetaData(),
        Column(column, String),
        schema=table.get("schema") or None,
    )
    field = target.c[column]
    # SQL Server cannot compare legacy TEXT/NTEXT with equality directly.
    dtype = next(
        (
            c.get("type", "").lower()
            for c in table.get("columns", [])
            if c["name"] == column
        ),
        "",
    )
    if kind == "mssql" and dtype in {"text", "ntext"}:
        field = cast(field, NVARCHAR(None))
    predicate = (
        field == value
        if mode == "exact"
        else field.like(pattern(value, kind), escape="!")
    )
    try:
        return (
            conn.execute(
                select(literal(1)).select_from(target).where(predicate).limit(1)
            ).first()
            is not None
        )
    finally:
        if kind == "sqlite":
            conn.connection.driver_connection.set_progress_handler(None, 0)


def search_targets(targets, value, mode, check_access):
    deadline = time.monotonic() + BATCH_SECONDS
    results = []
    for target in targets:
        check_access()
        row = {
            "source_id": target["source_id"],
            "source_name": target["source_name"],
            "database_name": target.get("database_name", ""),
            "table_key": target["table"]["key"],
            "table_name": target["table"]["name"],
            "schema": target["table"].get("schema") or "",
            "columns": [],
        }
        results.append(row)
        if time.monotonic() >= deadline:
            row["columns"] = [
                {"name": c, "status": "not_checked"} for c in target["columns"]
            ]
            continue
        try:
            with search_connection(target["kind"], target["cfg"]) as conn:
                for column in target["columns"]:
                    check_access()
                    remaining = deadline - time.monotonic()
                    if remaining < 1:
                        row["columns"].append({"name": column, "status": "not_checked"})
                        continue
                    try:
                        found = exists(
                            target["kind"],
                            conn,
                            target["table"],
                            column,
                            value,
                            mode,
                            min(QUERY_SECONDS, remaining),
                        )
                        row["columns"].append(
                            {
                                "name": column,
                                "status": "found" if found else "not_found",
                            }
                        )
                    except Exception as error:
                        row["columns"].append(
                            {
                                "name": column,
                                "status": "error",
                                "message": diagnostic(
                                    target["kind"], error, "value_search"
                                ),
                            }
                        )
                        if target["kind"] != "mongodb":
                            conn.rollback()
        except Exception as error:
            from fastapi import HTTPException

            if isinstance(error, HTTPException):
                raise
            checked = {c["name"] for c in row["columns"]}
            row["columns"].extend(
                {
                    "name": c,
                    "status": "error",
                    "message": diagnostic(target["kind"], error, "value_search"),
                }
                for c in target["columns"]
                if c not in checked
            )
    return results
