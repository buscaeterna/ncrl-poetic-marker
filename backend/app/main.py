import hashlib
import json
import shutil
import uuid
from pathlib import Path
from uuid import UUID

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from .database import SessionLocal
from .models import Job, JobStatus, Project, SourceDocument, SourcePage, utcnow
from .pdf import inspect_pdf, safe_path
from .schemas import (CapabilitiesResponse, ErrorEnvelope, HealthResponse, JobCreate,
                      JobResponse, ProjectCreate, ProjectDetail, ProjectSummary, ProjectUpdate)
from .settings import settings

app = FastAPI(title="NCRL Poetic Marker API", version=settings.version, docs_url="/api/docs", openapi_url="/api/openapi.json")


def database():
    with SessionLocal() as db:
        yield db


@app.middleware("http")
async def limit_body(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH"}:
        length = request.headers.get("content-length")
        limit = settings.max_pdf_bytes + 1024 * 1024 if "/sources" in request.url.path else settings.max_workspace_bytes
        if length and int(length) > limit:
            limit_mib = limit / (1024 * 1024)
            label = f"{limit_mib:g} MiB"
            return Response(json.dumps({"detail": {"code": "payload_too_large", "message": f"Request exceeds {label} limit"}}), 413, media_type="application/json")
    return await call_next(request)


@app.get("/api/v1/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    return HealthResponse(service=settings.service_name, version=settings.version)


@app.get("/api/v1/ready", response_model=HealthResponse, responses={503: {"model": ErrorEnvelope}}, tags=["system"])
def ready(db: Session = Depends(database)) -> HealthResponse:
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(503, detail={"code": "database_unavailable", "message": "Database is unavailable"}) from exc
    return HealthResponse(service=settings.service_name, version=settings.version)


@app.get("/api/v1/capabilities", response_model=CapabilitiesResponse, tags=["system"])
def capabilities() -> CapabilitiesResponse:
    return CapabilitiesResponse()


def missing(kind: str = "project") -> HTTPException:
    return HTTPException(404, detail={"code": f"{kind}_not_found", "message": f"{kind.title()} not found"})


@app.get("/api/v1/projects", response_model=list[ProjectSummary], tags=["projects"])
def list_projects(limit: int = Query(50, ge=1, le=100), db: Session = Depends(database)):
    return db.scalars(select(Project).order_by(Project.updated_at.desc()).limit(limit)).all()


@app.post("/api/v1/projects", response_model=ProjectDetail, status_code=201, responses={413: {"model": ErrorEnvelope}}, tags=["projects"])
def create_project(body: ProjectCreate, db: Session = Depends(database)):
    project = Project(name=body.name, schema_version=body.schema_version, workspace=body.workspace.model_dump(mode="json"))
    db.add(project); db.commit(); db.refresh(project)
    return project


@app.get("/api/v1/projects/{project_id}", response_model=ProjectDetail, responses={404: {"model": ErrorEnvelope}}, tags=["projects"])
def get_project(project_id: UUID, db: Session = Depends(database)):
    project = db.get(Project, project_id)
    if not project: raise missing()
    return project


@app.put("/api/v1/projects/{project_id}", response_model=ProjectDetail, responses={404: {"model": ErrorEnvelope}, 409: {"model": ErrorEnvelope}, 413: {"model": ErrorEnvelope}}, tags=["projects"])
def update_project(project_id: UUID, body: ProjectUpdate, db: Session = Depends(database)):
    result = db.execute(update(Project).where(Project.id == project_id, Project.revision == body.revision).values(name=body.name, schema_version=body.schema_version, workspace=body.workspace.model_dump(mode="json"), revision=body.revision + 1, updated_at=utcnow()))
    if result.rowcount == 0:
        current = db.get(Project, project_id)
        if not current: raise missing()
        raise HTTPException(409, detail={"code": "revision_conflict", "message": "Project has a newer revision", "current_revision": current.revision})
    db.commit()
    return db.get(Project, project_id)


@app.delete("/api/v1/projects/{project_id}", status_code=204, responses={404: {"model": ErrorEnvelope}}, tags=["projects"])
def delete_project(project_id: UUID, db: Session = Depends(database)):
    project = db.get(Project, project_id)
    if not project: raise missing()
    for document in project.source_documents:
        shutil.rmtree(safe_path(str(document.id)), ignore_errors=True)
    db.delete(project); db.commit()

def document_json(doc: SourceDocument, pages=False):
    data = {"id": doc.id, "project_id": doc.project_id, "original_name": doc.original_name, "size": doc.size, "sha256": doc.sha256, "upload_order": doc.upload_order, "page_count": doc.page_count, "kind": doc.kind, "status": doc.status, "error": doc.error, "revision": doc.revision, "created_at": doc.created_at, "updated_at": doc.updated_at}
    if pages: data["pages"] = [{"id": p.id, "page_number": p.page_number, "method": p.method, "raw_text": p.raw_text, "edited_text": p.edited_text, "embedded_text": p.embedded_text, "ocr_text": p.ocr_text, "confidence": p.confidence, "warnings": p.warnings, "review_status": p.review_status, "rotation": p.rotation, "revision": p.revision} for p in doc.pages]
    return data

@app.post("/api/v1/projects/{project_id}/sources", status_code=201, tags=["PDF sources"])
async def upload_source(project_id: UUID, file: UploadFile = File(), upload_order: int = Form(0), db: Session = Depends(database)):
    if not db.get(Project, project_id): raise missing()
    document_id, key = uuid.uuid4(), f"{uuid.uuid4()}.pdf"
    directory = safe_path(str(document_id)); directory.mkdir(parents=True, exist_ok=False)
    destination = directory / key; digest = hashlib.sha256(); size = 0; signature = b""
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                if not signature: signature = chunk[:5]
                size += len(chunk)
                if size > settings.max_pdf_bytes: raise HTTPException(413, detail={"code": "pdf_too_large", "message": "PDF exceeds configured size limit"})
                digest.update(chunk); output.write(chunk)
        if signature != b"%PDF-": raise HTTPException(415, detail={"code": "not_pdf", "message": "File does not have a PDF signature"})
        try: pages = inspect_pdf(destination)
        except PermissionError as exc: raise HTTPException(422, detail={"code": "encrypted_pdf", "message": str(exc)})
        except ValueError as exc: raise HTTPException(422, detail={"code": "invalid_pdf", "message": str(exc)})
        if pages > settings.max_pdf_pages: raise HTTPException(422, detail={"code": "too_many_pages", "message": "PDF exceeds configured page limit"})
        doc = SourceDocument(id=document_id, project_id=project_id, original_name=Path(file.filename or "document.pdf").name, storage_key=f"{document_id}/{key}", mime_type="application/pdf", size=size, sha256=digest.hexdigest(), upload_order=upload_order, page_count=pages)
        db.add(doc); db.commit(); db.refresh(doc); return document_json(doc)
    except Exception:
        shutil.rmtree(directory, ignore_errors=True); raise

@app.get("/api/v1/projects/{project_id}/sources", tags=["PDF sources"])
def list_sources(project_id: UUID, db: Session = Depends(database)):
    if not db.get(Project, project_id): raise missing()
    return [document_json(d) for d in db.scalars(select(SourceDocument).where(SourceDocument.project_id == project_id).order_by(SourceDocument.upload_order, SourceDocument.created_at)).all()]

@app.get("/api/v1/sources/{document_id}", tags=["PDF sources"])
def get_source(document_id: UUID, db: Session = Depends(database)):
    doc = db.get(SourceDocument, document_id)
    if not doc: raise missing("document")
    return document_json(doc, True)

@app.post("/api/v1/sources/{document_id}/extract", status_code=202, tags=["PDF sources"])
def start_extract(document_id: UUID, db: Session = Depends(database)):
    doc = db.get(SourceDocument, document_id)
    if not doc: raise missing("document")
    if doc.status in {"queued", "extracting"}: raise HTTPException(409, detail={"code": "document_state_conflict", "message": "Extraction already active"})
    doc.status = "queued"; doc.error = None; doc.revision += 1
    job = Job(project_id=doc.project_id, type="pdf_extract", result={"document_id": str(doc.id)})
    db.add(job); db.commit(); db.refresh(job); return {"job_id": job.id, "document": document_json(doc)}

@app.patch("/api/v1/sources/{document_id}/pages/{page_number}", tags=["PDF sources"])
async def edit_page(document_id: UUID, page_number: int, request: Request, db: Session = Depends(database)):
    body = await request.json(); page = db.scalar(select(SourcePage).where(SourcePage.document_id == document_id, SourcePage.page_number == page_number))
    if not page: raise missing("page")
    if body.get("revision") != page.revision: raise HTTPException(409, detail={"code": "revision_conflict", "message": "Page has a newer revision", "current_revision": page.revision})
    if "edited_text" in body: page.edited_text = body["edited_text"]
    if "review_status" in body: page.review_status = body["review_status"]
    if body.get("method") in {"ocr", "embedded_text"}:
        page.method = body["method"]; page.edited_text = page.ocr_text if page.method == "ocr" else page.embedded_text or ""
    page.revision += 1; db.commit(); return {"revision": page.revision}

@app.post("/api/v1/sources/{document_id}/approve", tags=["PDF sources"])
def approve_source(document_id: UUID, db: Session = Depends(database)):
    doc = db.get(SourceDocument, document_id)
    if not doc: raise missing("document")
    if not doc.pages or any(p.review_status not in {"approved", "excluded"} for p in doc.pages): raise HTTPException(409, detail={"code": "review_incomplete", "message": "Every page must be approved or excluded"})
    doc.status = "approved"; doc.revision += 1; db.commit(); return document_json(doc, True)

@app.get("/api/v1/sources/{document_id}/preview/{page_number}", tags=["PDF sources"])
def preview(document_id: UUID, page_number: int, db: Session = Depends(database)):
    page = db.scalar(select(SourcePage).where(SourcePage.document_id == document_id, SourcePage.page_number == page_number))
    if not page or not page.preview_key: raise missing("preview")
    return FileResponse(safe_path(page.preview_key), media_type="image/png")

@app.get("/api/v1/sources/{document_id}/download", tags=["PDF sources"])
def download_source(document_id: UUID, db: Session = Depends(database)):
    doc = db.get(SourceDocument, document_id)
    if not doc: raise missing("document")
    return FileResponse(safe_path(doc.storage_key), media_type="application/pdf", filename=doc.original_name)

@app.get("/api/v1/sources/{document_id}/text", tags=["PDF sources"])
def download_text(document_id: UUID, db: Session = Depends(database)):
    doc = db.get(SourceDocument, document_id)
    if not doc: raise missing("document")
    return PlainTextResponse("\n\n\f\n\n".join(p.edited_text for p in doc.pages if p.review_status != "excluded"))

@app.get("/api/v1/sources/{document_id}/json", tags=["PDF sources"])
def download_json(document_id: UUID, db: Session = Depends(database)):
    doc = db.get(SourceDocument, document_id)
    if not doc: raise missing("document")
    return document_json(doc, True)

@app.post("/api/v1/sources/{document_id}/pages/{page_number}/ocr", tags=["PDF sources"])
def repeat_page_ocr(document_id: UUID, page_number: int, revision: int, db: Session = Depends(database)):
    from .pdf import extract_page
    doc = db.get(SourceDocument, document_id)
    page = db.scalar(select(SourcePage).where(SourcePage.document_id == document_id, SourcePage.page_number == page_number))
    if not doc or not page: raise missing("page")
    if page.revision != revision: raise HTTPException(409, detail={"code":"revision_conflict","message":"Page has a newer revision","current_revision":page.revision})
    result = extract_page(safe_path(doc.storage_key), page_number, safe_path(page.preview_key), True)
    # Preserve manual edits: the new OCR is an alternative until explicitly selected.
    page.ocr_text=result["ocr"]; page.confidence=result["confidence"]; page.warnings=result["warnings"]; page.revision += 1
    db.commit(); return {"revision":page.revision,"ocr_text":page.ocr_text,"confidence":page.confidence,"warnings":page.warnings}

@app.delete("/api/v1/sources/{document_id}", status_code=204, tags=["PDF sources"])
def delete_source(document_id: UUID, db: Session = Depends(database)):
    doc = db.get(SourceDocument, document_id)
    if not doc: raise missing("document")
    if doc.status in {"queued", "extracting"}: raise HTTPException(409, detail={"code":"document_active","message":"Cancel active extraction before deleting the source"})
    shutil.rmtree(safe_path(str(doc.id)), ignore_errors=True); db.delete(doc); db.commit()


@app.post("/api/v1/projects/{project_id}/jobs", response_model=JobResponse, status_code=201, responses={404: {"model": ErrorEnvelope}}, tags=["jobs"])
def create_job(project_id: UUID, body: JobCreate, db: Session = Depends(database)):
    if not db.get(Project, project_id): raise missing()
    if body.type == "pdf_extract": raise HTTPException(422, detail={"code":"document_required","message":"Start PDF extraction from the source document endpoint"})
    job = Job(project_id=project_id, type=body.type)
    db.add(job); db.commit(); db.refresh(job)
    return job


@app.get("/api/v1/projects/{project_id}/jobs", response_model=list[JobResponse], responses={404: {"model": ErrorEnvelope}}, tags=["jobs"])
def list_jobs(project_id: UUID, limit: int = Query(50, ge=1, le=100), db: Session = Depends(database)):
    if not db.get(Project, project_id): raise missing()
    return db.scalars(select(Job).where(Job.project_id == project_id).order_by(Job.created_at.desc()).limit(limit)).all()


@app.get("/api/v1/jobs/{job_id}", response_model=JobResponse, responses={404: {"model": ErrorEnvelope}}, tags=["jobs"])
def get_job(job_id: UUID, db: Session = Depends(database)):
    job = db.get(Job, job_id)
    if not job: raise missing("job")
    return job


@app.post("/api/v1/jobs/{job_id}/cancel", response_model=JobResponse, responses={404: {"model": ErrorEnvelope}, 409: {"model": ErrorEnvelope}}, tags=["jobs"])
def cancel_job(job_id: UUID, db: Session = Depends(database)):
    job = db.get(Job, job_id)
    if not job: raise missing("job")
    if job.status == JobStatus.running:
        job.status = JobStatus.cancel_requested; db.commit(); db.refresh(job); return job
    if job.status != JobStatus.queued:
        raise HTTPException(409, detail={"code": "job_state_conflict", "message": f"Cannot cancel {job.status.value} job"})
    job.status, job.finished_at = JobStatus.cancelled, utcnow()
    db.commit(); db.refresh(job)
    return job
