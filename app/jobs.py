"""Single-process scan queue and persistent, permission-aware scheduler."""

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from sqlalchemy import select
from fastapi import HTTPException
from .i18n import tr, tr_message
from .models import Session, Source, Job, Snapshot, ScanSchedule, User, now
from .security import decrypt, access, audit
from .connectors import scan, ConnectorError
from .search import reindex_source

scan_lock = threading.Lock()
executor = None
scheduler_thread = None
stop_event = threading.Event()
logger = logging.getLogger(__name__)


def next_due(schedule, after):
    if schedule.cadence == "hourly":
        return after + timedelta(hours=1)
    zone = ZoneInfo(schedule.timezone)
    local = after.replace(tzinfo=timezone.utc).astimezone(zone)
    for day in range(9):
        date = local.date() + timedelta(days=day)
        if schedule.cadence == "weekly" and date.weekday() != schedule.weekday:
            continue
        # First occurrence at autumn DST; nonexistent spring times shift forward.
        candidate = (
            datetime(
                date.year,
                date.month,
                date.day,
                schedule.hour,
                schedule.minute,
                tzinfo=zone,
                fold=0,
            )
            .astimezone(timezone.utc)
            .replace(tzinfo=None)
        )
        if candidate > after:
            return candidate
    raise ValueError(tr("Kein nächster Termin gefunden."))


def schedule_json(schedule):
    if not schedule:
        return {
            "enabled": False,
            "cadence": "daily",
            "hour": 2,
            "minute": 0,
            "weekday": 0,
            "timezone": "Europe/Berlin",
            "next_run": None,
            "last_started": None,
            "last_job_id": None,
            "message": "",
        }
    return {
        field: (
            tr_message(getattr(schedule, field))
            if field == "message"
            else getattr(schedule, field)
        )
        for field in (
            "enabled",
            "cadence",
            "hour",
            "minute",
            "weekday",
            "timezone",
            "next_run",
            "last_started",
            "last_job_id",
            "message",
        )
    }


def enqueue(db, source_id, user, scheduled=False):
    """Caller holds scan_lock and commits before dispatching the returned job."""
    access(db, user, source_id, edit=True)
    active = list(db.scalars(select(Job).where(Job.status.in_(["queued", "running"]))))
    if any(j.source_id == source_id for j in active):
        raise HTTPException(409, tr("Für diese Quelle läuft bereits ein Scan."))
    if len(active) >= 10:
        raise HTTPException(
            429, tr("Scan-Warteschlange ist voll. Bitte später versuchen.")
        )
    job = Job(source_id=source_id)
    db.add(job)
    db.flush()
    audit(
        db, user, "scheduled_scan_started" if scheduled else "scan_started", source_id
    )
    return job


def dispatch(job_id):
    executor.submit(run_scan, job_id)


def scheduler_tick(at=None):
    at = at or now()
    with Session() as db:
        due_ids = list(
            db.scalars(
                select(ScanSchedule.source_id)
                .where(ScanSchedule.enabled.is_(True), ScanSchedule.next_run <= at)
                .order_by(ScanSchedule.next_run)
                .limit(100)
            )
        )
    for source_id in due_ids:
        with scan_lock, Session() as db:
            schedule = db.get(ScanSchedule, source_id)
            if (
                not schedule
                or not schedule.enabled
                or not schedule.next_run
                or schedule.next_run > at
            ):
                continue
            user = (
                db.get(User, schedule.created_by_id) if schedule.created_by_id else None
            )
            try:
                if not user or not user.active:
                    raise HTTPException(403, tr("Konto deaktiviert."))
                access(db, user, source_id, edit=True)
            except HTTPException:
                schedule.enabled = False
                schedule.next_run = None
                schedule.message = tr(
                    "Zeitplan deaktiviert: Das einrichtende Konto hat keine Bearbeitungsrechte mehr."
                )
                if user:
                    audit(db, user, "schedule_disabled_access", source_id)
                db.commit()
                continue
            try:
                job = enqueue(db, source_id, user, scheduled=True)
            except HTTPException as error:
                if error.status_code not in {409, 429}:
                    raise
                schedule.message = tr("Termin wartet auf einen freien Scan-Platz.")
                db.commit()
                continue
            schedule.next_run = next_due(schedule, at)
            schedule.last_started = at
            schedule.last_job_id = job.id
            schedule.message = tr("Automatischer Scan gestartet.")
            db.commit()
            dispatch(job.id)


def scheduler_loop():
    while not stop_event.wait(30):
        try:
            scheduler_tick()
        except Exception as error:
            # Avoid logging connection strings or driver exception contents.
            logger.error("Scheduler tick failed (%s)", type(error).__name__)


def start_workers():
    global executor, scheduler_thread
    executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="schema-scan")
    stop_event.clear()
    if os.getenv("DISABLE_SCHEDULER") != "1":
        scheduler_thread = threading.Thread(
            target=scheduler_loop, name="scan-scheduler", daemon=True
        )
        scheduler_thread.start()


def stop_workers():
    global scheduler_thread
    stop_event.set()
    if scheduler_thread:
        scheduler_thread.join()
        scheduler_thread = None
    executor.shutdown(wait=True)


def run_scan(job_id):
    with Session() as db:
        job = db.get(Job, job_id)
        source = db.get(Source, job.source_id) if job else None
        if not source:
            return
        job.status = "running"
        job.message = tr("Metadaten werden ausgelesen.")
        db.commit()
        try:
            payload = scan(source.kind, decrypt(source), source.mongo_infer)
            with scan_lock:
                db.add(Snapshot(source_id=source.id, payload=payload))
                reindex_source(db, source)
                job.status = "completed"
                job.message = tr("{0} Objekte dokumentiert.", len(payload["tables"]))
                job.finished = now()
                db.commit()
        except Exception as error:
            # Roll back snapshot/index together, preserving the previous searchable schema.
            db.rollback()
            job = db.get(Job, job_id)
            job.status = "failed"
            job.message = (
                str(error)
                if isinstance(error, ConnectorError)
                else tr(
                    "Scan fehlgeschlagen ({0}). Bitte Erreichbarkeit, TLS und Leserechte prüfen.",
                    type(error).__name__,
                )
            )
            job.finished = now()
            db.commit()
