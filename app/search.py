"""Index only the latest documented metadata; never connection secrets or row values."""

from sqlalchemy import select, delete, insert
from .models import Source, Snapshot, Note, SearchEntry, SchemaVersion


def reindex_source(db, source):
    db.flush()
    db.execute(delete(SearchEntry).where(SearchEntry.source_id == source.id))
    snapshot = db.scalar(
        select(Snapshot)
        .where(Snapshot.source_id == source.id)
        .order_by(Snapshot.id.desc())
        .limit(1)
    )
    if not snapshot:
        return
    notes = {
        n.table_key: n.text
        for n in db.scalars(select(Note).where(Note.source_id == source.id))
    }
    entries = []
    for table in snapshot.payload["tables"]:
        name = ".".join(filter(None, [table.get("schema"), table["name"]]))
        common = {"source_id": source.id, "table_key": table["key"], "table_name": name}
        entries.append(
            {
                **common,
                "kind": "table",
                "column_name": None,
                "title": name,
                "content": f'{source.name} {name} {table.get("comment") or ""}'.casefold(),
            }
        )
        for column in table["columns"]:
            entries.append(
                {
                    **common,
                    "kind": "column",
                    "column_name": column["name"],
                    "title": f'{name}.{column["name"]}',
                    "content": f'{source.name} {name} {column["name"]} {column["type"]} {column.get("comment") or ""}'.casefold(),
                }
            )
        if notes.get(table["key"], "").strip():
            entries.append(
                {
                    **common,
                    "kind": "note",
                    "column_name": None,
                    "title": name,
                    "content": f'{source.name} {name} {notes[table["key"]]}'.casefold(),
                }
            )
    # Bounded batches avoid SQL parameter limits on large schemas.
    for start in range(0, len(entries), 500):
        db.execute(insert(SearchEntry), entries[start : start + 500])


def migrate(db):
    """Additive migration: backfill once, retaining every existing source/snapshot/note."""
    if not db.get(SchemaVersion, "catalog-features-v1"):
        for source in db.scalars(select(Source)):
            reindex_source(db, source)
        db.add(SchemaVersion(version="catalog-features-v1"))
        db.commit()
