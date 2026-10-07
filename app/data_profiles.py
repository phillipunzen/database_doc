"""Explicit bounded read-only profiles. Raw rows never enter application storage."""

import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from bson.decimal128 import Decimal128
from sqlalchemy import Table, Column, MetaData, select
from . import connectors
from .source_analysis import family


def fingerprint(value):
    number = numeric(value)
    if number is not None:
        sign, digits, exponent = number.as_tuple()
        digits = list(digits)
        while len(digits) > 1 and digits[-1] == 0:
            digits.pop()
            exponent += 1
        if not any(digits):
            sign, exponent = 0, 0
        data = f'{sign}:{"".join(str(d) for d in digits)}:{exponent}'.encode()
        return hashlib.sha256(b"number:" + data).hexdigest()
    if isinstance(value, bytes):
        data = value
    else:
        data = json.dumps(
            value, default=str, ensure_ascii=False, sort_keys=True
        ).encode()
    return hashlib.sha256(type(value).__name__.encode() + b":" + data).hexdigest()


def numeric(value):
    if isinstance(value, Decimal128):
        value = value.to_decimal()
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    try:
        result = Decimal(str(value))
        return result if result.is_finite() else None
    except InvalidOperation:
        return None


def timestamp(value):
    try:
        result = (
            value
            if isinstance(value, datetime)
            else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        )
        return (
            result.replace(tzinfo=timezone.utc)
            if not result.tzinfo
            else result.astimezone(timezone.utc)
        )
    except (ValueError, TypeError):
        return None


def mongo_value(doc, field):
    value = doc
    for part in field.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def read_rows(kind, cfg, table, columns, limit):
    if kind == "mongodb":
        with connectors.mongo(cfg) as db:
            projection = {c: 1 for c in columns}
            if "_id" not in columns:
                projection["_id"] = 0
            docs = list(
                db[table["name"]]
                .find({}, projection, max_time_ms=15000)
                .limit(limit + 1)
            )
            return [[mongo_value(doc, c) for c in columns] for doc in docs]
    with connectors.relational(kind, cfg) as conn:
        target = Table(
            table["name"],
            MetaData(),
            *[Column(c) for c in columns],
            schema=table.get("schema") or None,
        )
        return [list(row) for row in conn.execute(select(*target.c).limit(limit + 1))]


def summarize(rows, table, columns, limit, at):
    more = len(rows) > limit
    rows = rows[:limit]
    result = {
        "row_count": len(rows),
        "sample_limit": limit,
        "complete_read": not more,
        "selection": "first_rows_unordered",
        "columns": [],
        "keys": [],
        "rules": [],
    }
    metadata = {c["name"]: c for c in table["columns"]}
    for i, name in enumerate(columns):
        values = [row[i] for row in rows]
        present = [v for v in values if v is not None]
        counts = Counter(fingerprint(v) for v in present)
        numbers = [n for v in present if (n := numeric(v)) is not None]
        times = (
            [t for v in present if (t := timestamp(v)) is not None]
            if family(metadata[name].get("type", "")) == "time"
            else []
        )
        lengths = [len(v) for v in present if isinstance(v, (str, bytes))]
        result["columns"].append(
            {
                "name": name,
                "type": metadata[name].get("type", ""),
                "null_count": len(values) - len(present),
                "empty_count": sum(
                    isinstance(v, str) and not v.strip() for v in present
                ),
                "distinct_non_null": len(counts),
                "duplicate_non_null": sum(n - 1 for n in counts.values()),
                "numeric_count": len(numbers),
                "min_number": str(min(numbers)) if numbers else None,
                "max_number": str(max(numbers)) if numbers else None,
                "min_time": min(times).isoformat() if times else None,
                "max_time": max(times).isoformat() if times else None,
                "time_count": len(times),
                "min_length": min(lengths) if lengths else None,
                "max_length": max(lengths) if lengths else None,
                "observed_types": sorted({type(v).__name__ for v in present}),
            }
        )
    pk = table.get("primary_key", [])
    if pk and all(c in columns for c in pk):
        indexes = [columns.index(c) for c in pk]
        hashes = [fingerprint([fingerprint(row[i]) for i in indexes]) for row in rows]
        result["keys"].append(
            {
                "columns": pk,
                "duplicates": len(hashes) - len(set(hashes)),
                "null_rows": sum(any(row[i] is None for i in indexes) for row in rows),
            }
        )
    return result


def evaluate_rules(profile, rules, table_key, at):
    stats = {c["name"]: c for c in profile["columns"]}
    results = []
    for rule in rules:
        if rule["table_key"] != table_key:
            continue
        c = stats.get(rule["column"])
        status, observed = "not_checked", None
        if c and profile["row_count"]:
            failed = False
            if rule["kind"] == "not_null":
                observed = c["null_count"]
                failed = observed > 0
            elif rule["kind"] == "not_empty":
                observed = c["null_count"] + c["empty_count"]
                failed = observed > 0
            elif rule["kind"] == "unique":
                observed = c["duplicate_non_null"]
                failed = observed > 0
            elif rule["kind"] == "range":
                if (
                    c["numeric_count"] != profile["row_count"] - c["null_count"]
                    or not c["numeric_count"]
                ):
                    results.append(
                        {
                            "id": rule["id"],
                            "name": rule["name"],
                            "kind": rule["kind"],
                            "column": rule["column"],
                            "status": "not_checked",
                            "observed": None,
                        }
                    )
                    continue
                observed = {"min": c["min_number"], "max": c["max_number"]}
                failed = (
                    rule.get("minimum") is not None
                    and Decimal(c["min_number"]) < Decimal(str(rule["minimum"]))
                ) or (
                    rule.get("maximum") is not None
                    and Decimal(c["max_number"]) > Decimal(str(rule["maximum"]))
                )
            elif rule["kind"] == "freshness":
                if (
                    not c["max_time"]
                    or c["time_count"] != profile["row_count"] - c["null_count"]
                ):
                    results.append(
                        {
                            "id": rule["id"],
                            "name": rule["name"],
                            "kind": rule["kind"],
                            "column": rule["column"],
                            "status": "not_checked",
                            "observed": None,
                        }
                    )
                    continue
                observed = max(
                    0,
                    (
                        at.replace(tzinfo=timezone.utc) - timestamp(c["max_time"])
                    ).total_seconds()
                    / 3600,
                )
                failed = observed > rule["max_age_hours"]
                if failed and not profile["complete_read"]:
                    status = "inconclusive"
            if status != "inconclusive":
                status = (
                    "failed"
                    if failed
                    else "passed" if profile["complete_read"] else "sample_passed"
                )
        results.append(
            {
                "id": rule["id"],
                "name": rule["name"],
                "kind": rule["kind"],
                "column": rule["column"],
                "status": status,
                "observed": observed,
            }
        )
    return results
