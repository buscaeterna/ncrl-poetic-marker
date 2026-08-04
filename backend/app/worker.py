import signal
import time
from datetime import timedelta

from sqlalchemy import select

from .database import SessionLocal
from .models import Job, JobStatus, Project, utcnow
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
        "modified_poems": sum(bool(poem.get("dirty")) for poem in poems),
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
            if job.type != "workspace_summary":
                raise ValueError(f"unsupported job type: {job.type}")
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


def run() -> None:
    global stopping
    signal.signal(signal.SIGTERM, lambda *_: globals().__setitem__("stopping", True))
    while not stopping:
        recover_stale()
        if not process_one():
            time.sleep(settings.worker_poll_seconds)


if __name__ == "__main__":
    run()
