from concurrent.futures import ThreadPoolExecutor
from sqlalchemy import select
from .models import Session, Source, Job, Snapshot, now
from .security import decrypt
from .connectors import scan, ConnectorError

executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="schema-scan")


def run_scan(job_id):
    with Session() as db:
        job = db.get(Job, job_id)
        source = db.get(Source, job.source_id) if job else None
        if not source:
            return
        job.status = "running"
        job.message = "Metadaten werden ausgelesen."
        db.commit()
        try:
            payload = scan(source.kind, decrypt(source), source.mongo_infer)
            db.add(Snapshot(source_id=source.id, payload=payload))
            job.status = "completed"
            job.message = f'{len(payload["tables"])} Objekte dokumentiert.'
        except Exception as error:
            job.status = "failed"
            job.message = (
                str(error)
                if isinstance(error, ConnectorError)
                else f"Scan fehlgeschlagen ({type(error).__name__}). Bitte Erreichbarkeit, TLS und Leserechte prüfen."
            )
        job.finished = now()
        db.commit()
