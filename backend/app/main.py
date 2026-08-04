import json
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from .database import SessionLocal
from .models import Job, JobStatus, Project, utcnow
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
        if length and int(length) > settings.max_workspace_bytes:
            limit_mib = settings.max_workspace_bytes / (1024 * 1024)
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
    db.delete(project); db.commit()


@app.post("/api/v1/projects/{project_id}/jobs", response_model=JobResponse, status_code=201, responses={404: {"model": ErrorEnvelope}}, tags=["jobs"])
def create_job(project_id: UUID, body: JobCreate, db: Session = Depends(database)):
    if not db.get(Project, project_id): raise missing()
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
    if job.status != JobStatus.queued:
        raise HTTPException(409, detail={"code": "job_state_conflict", "message": f"Cannot cancel {job.status.value} job"})
    job.status, job.finished_at = JobStatus.cancelled, utcnow()
    db.commit(); db.refresh(job)
    return job
