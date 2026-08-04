import signal
import time
from datetime import timedelta

from sqlalchemy import select

from .database import SessionLocal
from .models import Job, JobStatus, Project, SourceDocument, SourcePage, utcnow
from .pdf import extract_page, safe_path
from .settings import settings

stopping = False


def workspace_summary(project: Project) -> dict:
    workspace = project.workspace
    poems = workspace.get("poems", [])
    statuses: dict[str, int] = {}
    for poem in poems:
        status = poem.get("status", "unprocessed")
        statuses[status] = statuses.get(status, 0) + 1
    return {
        "corpora": len(workspace.get("corpora", [])),
        "poems": len(poems),
        "verse_lines": sum(len(poem.get("lines", [])) for poem in poems),
        "modified_poems": sum(bool(poem.get("modified", poem.get("dirty", False))) for poem in poems),
        "statuses": statuses,
        "revision": project.revision,
    }


def recover_stale() -> None:
    cutoff = utcnow() - timedelta(seconds=settings.job_lease_seconds)
    with SessionLocal.begin() as db:
        jobs = db.scalars(select(Job).where(Job.status == JobStatus.running, Job.updated_at < cutoff)).all()
        for job in jobs:
            if job.attempts >= settings.job_max_attempts:
                job.status, job.error, job.finished_at = JobStatus.failed, "worker lease expired", utcnow()
            else:
                job.status, job.started_at = JobStatus.queued, None


def claim_job():
    with SessionLocal.begin() as db:
        job = db.scalar(select(Job).where(Job.status == JobStatus.queued).order_by(Job.created_at).with_for_update(skip_locked=True).limit(1))
        if not job:
            return None
        job.status, job.started_at, job.updated_at = JobStatus.running, utcnow(), utcnow()
        job.attempts += 1
        return job.id


def process_one() -> bool:
    job_id = claim_job()
    if not job_id:
        return False
    with SessionLocal.begin() as db:
        job = db.get(Job, job_id)
        try:
            if job is None:
                return True
            if job.type == "pdf_extract":
                process_pdf(job.id)
                return True
            if job.type != "workspace_summary": raise ValueError(f"unsupported job type: {job.type}")
            project = db.get(Project, job.project_id)
            if project is None:
                raise ValueError("project no longer exists")
            job.result = workspace_summary(project)
            job.status, job.progress = JobStatus.succeeded, 1
        except Exception as exc:  # worker boundary records errors rather than crashing
            if job:
                job.status, job.error = JobStatus.failed, str(exc)
        if job:
            job.finished_at = job.updated_at = utcnow()
    return True

def process_pdf(job_id) -> None:
    with SessionLocal.begin() as db:
        job = db.get(Job, job_id); doc = db.get(SourceDocument, job.result["document_id"])
        if not doc: raise ValueError("source document no longer exists")
        doc.status = "extracting"; path = safe_path(doc.storage_key); total = doc.page_count
    methods = []
    for number in range(1, total + 1):
        with SessionLocal() as db:
            job = db.get(Job, job_id)
            if stopping or job.status == JobStatus.cancel_requested:
                job.status = JobStatus.cancelled; job.finished_at = utcnow(); db.get(SourceDocument, job.result["document_id"]).status = "cancelled"; db.commit(); return
        try:
            preview_key = f"{doc.id}/previews/{number}.png"
            result = extract_page(path, number, safe_path(preview_key))
            error = None
        except Exception as exc:
            result = {"embedded": None, "ocr": None, "text": "", "method": None, "confidence": None, "warnings": [f"Ошибка страницы: {exc}"], "rotation": 0}; error = str(exc)
        with SessionLocal.begin() as db:
            page = db.scalar(select(SourcePage).where(SourcePage.document_id == doc.id, SourcePage.page_number == number)) or SourcePage(document_id=doc.id, page_number=number)
            page.method, page.raw_text, page.edited_text = result["method"], result["text"], result["text"]
            page.embedded_text, page.ocr_text, page.confidence = result["embedded"], result["ocr"], result["confidence"]
            page.warnings, page.rotation, page.preview_key = result["warnings"], result["rotation"], preview_key
            if error: page.review_status = "error"
            db.add(page); job = db.get(Job, job_id); job.progress = number / total; job.updated_at = utcnow()
            methods.append(result["method"])
    with SessionLocal.begin() as db:
        job = db.get(Job, job_id); doc = db.get(SourceDocument, doc.id)
        doc.kind = "mixed_pdf" if len(set(methods)) > 1 else ("scanned_pdf" if methods and methods[0] == "ocr" else "digital_pdf")
        doc.status = "review"; doc.revision += 1
        job.status, job.progress, job.finished_at = JobStatus.succeeded, 1, utcnow()
        job.result = {"document_id": str(doc.id), "pages": total, "warnings": sum(m is None for m in methods)}


def run() -> None:
    global stopping
    signal.signal(signal.SIGTERM, lambda *_: globals().__setitem__("stopping", True))
    while not stopping:
        recover_stale()
        if not process_one():
            time.sleep(settings.worker_poll_seconds)


if __name__ == "__main__":
    run()
