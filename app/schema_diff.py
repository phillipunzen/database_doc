"""Structural comparison of stored snapshots without querying source databases."""

import json

COLUMN_FIELDS = ("type", "nullable", "default", "primary_key", "comment")
TABLE_FIELDS = (
    "kind",
    "comment",
    "primary_key",
    "foreign_keys",
    "indexes",
    "unique_constraints",
    "validator",
)
UNORDERED = {"foreign_keys", "indexes", "unique_constraints"}


def canonical(field, value):
    if field in UNORDERED:
        return sorted(
            value or [],
            key=lambda item: json.dumps(item, sort_keys=True, ensure_ascii=False),
        )
    if field == "comment":
        return value or ""
    return value


def changes(before, after, fields):
    result = {}
    for field in fields:
        left, right = canonical(field, before.get(field)), canonical(
            field, after.get(field)
        )
        if left != right:
            result[field] = {"before": left, "after": right}
    return result


def compare(before, after):
    old = {t["key"]: t for t in before["tables"]}
    new = {t["key"]: t for t in after["tables"]}
    added = [new[k] for k in sorted(new.keys() - old.keys())]
    removed = [old[k] for k in sorted(old.keys() - new.keys())]
    changed = []
    for key in sorted(old.keys() & new.keys()):
        left, right = old[key], new[key]
        lc = {c["name"]: c for c in left["columns"]}
        rc = {c["name"]: c for c in right["columns"]}
        item = {
            "key": key,
            "schema": right.get("schema"),
            "name": right["name"],
            "added_columns": [rc[n] for n in sorted(rc.keys() - lc.keys())],
            "removed_columns": [lc[n] for n in sorted(lc.keys() - rc.keys())],
            "changed_columns": [],
            "changes": changes(left, right, TABLE_FIELDS),
        }
        for name in sorted(lc.keys() & rc.keys()):
            delta = changes(lc[name], rc[name], COLUMN_FIELDS)
            if delta:
                item["changed_columns"].append({"name": name, "changes": delta})
        if any(
            item[k]
            for k in ("added_columns", "removed_columns", "changed_columns", "changes")
        ):
            changed.append(item)
    return {
        "added_tables": added,
        "removed_tables": removed,
        "changed_tables": changed,
        "summary": {
            "added_tables": len(added),
            "removed_tables": len(removed),
            "changed_tables": len(changed),
            "added_columns": sum(len(t["columns"]) for t in added)
            + sum(len(t["added_columns"]) for t in changed),
            "removed_columns": sum(len(t["columns"]) for t in removed)
            + sum(len(t["removed_columns"]) for t in changed),
            "changed_columns": sum(len(t["changed_columns"]) for t in changed),
        },
        "inferred": bool(before.get("inferred") or after.get("inferred")),
    }
