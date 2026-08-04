import signal
import time
from datetime import timedelta
from uuid import UUID

from sqlalchemy import select

from .database import SessionLocal
from .models import Job, JobStatus, Project, SourceDocument, SourcePage, utcnow
from .pdf import extract_page, safe_path
from .settings import settings
from .stress import analyse_line
from .model import get_spec, load_provider

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
        cancelled = db.scalars(select(Job).where(Job.status == JobStatus.cancel_requested, Job.updated_at < cutoff)).all()
        for job in cancelled:
            job.status, job.finished_at, job.error = JobStatus.cancelled, utcnow(), "worker stopped after cancellation request"
            if job.type == "pdf_extract" and job.result:
                document = db.get(SourceDocument, job.result.get("document_id"))
                if document: document.status = "cancelled"


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
                try: process_pdf(job.id)
                except Exception as exc:
                    with SessionLocal.begin() as error_db:
                        failed=error_db.get(Job,job.id); failed.status=JobStatus.failed; failed.error=str(exc); failed.finished_at=utcnow()
                        if failed.result:
                            document=error_db.get(SourceDocument,failed.result.get("document_id"))
                            if document: document.status="error"; document.error=str(exc)
                return True
            if job.type == "pdf_page_ocr":
                process_page_ocr(job.id)
                return True
            if job.type == "stress_analysis":
                process_stress(job.id)
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

def process_stress(job_id) -> None:
    with SessionLocal() as db:
        job=db.get(Job,job_id); project=db.get(Project,job.project_id); payload=dict(job.result or {})
        if not project or project.revision != payload.get("workspace_revision"):
            raise ValueError("workspace revision changed before stress analysis")
        selected=set(payload["poem_ids"])
        selected_lines=set(payload.get("line_ids") or [])
        spec=get_spec(payload["model_id"],payload["model_version"])
        # Preserve workspace order, never request order.
        work=[(p.get("id"), line.get("id"), line.get("text", ""))
              for p in project.workspace.get("poems",[]) if str(p.get("id")) in selected
              for line in p.get("lines",[]) if not selected_lines or str(line.get("id")) in selected_lines]
    provider=load_provider(spec)
    results={}; uncertain=0
    for index,(poem_id,line_id,text) in enumerate(work):
        with SessionLocal.begin() as db:
            job=db.get(Job,job_id)
            if stopping or job.status==JobStatus.cancel_requested:
                job.status=JobStatus.cancelled;job.finished_at=utcnow();return
        suggestion=analyse_line(text,provider);suggestion["analysedAt"]=utcnow().isoformat()
        results.setdefault(str(poem_id),{})[str(line_id)]=suggestion
        uncertain += len(suggestion["uncertainWords"])
        with SessionLocal.begin() as db:
            job=db.get(Job,job_id);job.progress=(index+1)/max(1,len(work));job.updated_at=utcnow()
            job.result={**payload,"processed_lines":index+1,"uncertain_words":uncertain}
    with SessionLocal.begin() as db:
        job=db.get(Job,job_id);project=db.get(Project,job.project_id)
        if stopping or job.status==JobStatus.cancel_requested:
            job.status=JobStatus.cancelled;job.finished_at=utcnow();return
        if project.revision != payload["workspace_revision"]:
            job.status=JobStatus.failed;job.error="workspace revision changed during stress analysis";job.finished_at=utcnow();return
        workspace=dict(project.workspace); poems=[]
        for poem in workspace.get("poems",[]):
            poem=dict(poem)
            if str(poem.get("id")) in results:
                poem["lines"]=[{**line,"stressSuggestion":results[str(poem["id"])].get(str(line.get("id")),line.get("stressSuggestion"))} for line in poem.get("lines",[])]
            poems.append(poem)
        workspace["poems"]=poems;project.workspace=workspace;project.revision+=1
        job.status=JobStatus.succeeded;job.progress=1;job.finished_at=job.updated_at=utcnow()
        job.result={**payload,"processed_poems":len(results),"processed_lines":len(work),
                    "uncertain_words":uncertain,"project_revision":project.revision}

def process_page_ocr(job_id) -> None:
    with SessionLocal.begin() as db:
        job=db.get(Job,job_id); payload=dict(job.result or {})
        document_id=UUID(payload["document_id"])
        document=db.get(SourceDocument,document_id)
        page=db.scalar(select(SourcePage).where(SourcePage.document_id==document.id,SourcePage.page_number==payload.get("page_number"))) if document else None
        if not document or not page: raise ValueError("OCR page no longer exists")
        if document.status != "review": raise ValueError("document left review before OCR started")
        if page.revision != payload.get("expected_revision"): raise ValueError("page revision changed before OCR started")
        path=safe_path(document.storage_key); preview=safe_path(page.preview_key)
    result=extract_page(path,page.page_number,preview,True)
    with SessionLocal.begin() as db:
        job=db.get(Job,job_id); page=db.get(SourcePage,page.id); document=db.get(SourceDocument,document.id)
        if job.status==JobStatus.cancel_requested:
            job.status=JobStatus.cancelled;job.finished_at=utcnow();return
        if page.revision != payload["expected_revision"]: raise ValueError("page revision changed during OCR")
        if document.status != "review": raise ValueError("document left review before OCR result could be saved")
        # Manual edited_text and selected method deliberately remain untouched.
        page.ocr_text=result["ocr"];page.confidence=result["confidence"];page.warnings=result["warnings"];page.revision+=1
        job.status=JobStatus.succeeded;job.progress=1;job.finished_at=job.updated_at=utcnow()
        job.result={"document_id":str(document.id),"page_number":page.page_number,"page_revision":page.revision}

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
