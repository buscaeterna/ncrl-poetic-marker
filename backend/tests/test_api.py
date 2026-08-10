from datetime import timedelta
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app, database
from app.models import Job, JobStatus, utcnow
from app.settings import settings
from app.worker import claim_job, process_one, recover_stale

client = TestClient(app)
workspace = {
    "corpora": [{
        "id": "c", "encoding": "windows-1251", "eol": "\r\n",
        "originalSource": "строка\r\nещё", "unknownCorpus": {"future": 1},
    }],
    "poems": [{
        "id": "p", "lines": [{"text": "раз"}, {"text": "два"}],
        "status": "ready", "modified": True, "dirty": False,
        "unknownPoem": ["сохранить"],
    }],
    "activeId": "p", "queue": ["p"], "unknownWorkspace": True,
}


def create():
    response = client.post("/api/v1/projects", json={"name": "Тест", "workspace": workspace})
    assert response.status_code == 201
    return response.json()


def assert_error(response, status: int, code: str):
    assert response.status_code == status
    assert response.json()["detail"]["code"] == code


def test_health_capabilities_and_error_openapi():
    assert client.get("/api/v1/health").status_code == 200
    assert client.get("/api/v1/ready").status_code == 200
    assert client.get("/api/v1/capabilities").json() == {
        "workspace": True, "jobs": True, "pdf": True, "ocr": True,
        "stress": True, "meter": True, "local_model": False,
    }
    schema = client.get("/api/openapi.json").json()
    error_schema = schema["components"]["schemas"]["ErrorEnvelope"]
    assert "detail" in error_schema["properties"]
    assert schema["paths"]["/api/v1/projects/{project_id}"]["put"]["responses"]["409"]

def test_capabilities_reflect_production_model_not_test_provider(monkeypatch):
    monkeypatch.setattr("app.main.installed",lambda spec: True)
    assert client.get("/api/v1/capabilities").json()["local_model"] is True
    models=client.get("/api/v1/stress/models").json()
    assert [model["id"] for model in models]==["silero-stress"]
    assert all(model["id"]!="ncrl-test-dictionary" for model in models)

def test_stress_job_rejects_unknown_and_uninstalled_model(monkeypatch):
    project=create();url=f'/api/v1/projects/{project["id"]}/stress/jobs'
    base={"poem_ids":["p"],"revision":1,"model_id":"silero-stress","model_version":"1.4"}
    assert_error(client.post(url,json={**base,"model_id":"untrusted"}),422,"unknown_model")
    monkeypatch.setattr("app.main.installed",lambda spec:False)
    assert_error(client.post(url,json=base),409,"model_not_installed")

def test_worker_uses_exact_selected_production_provider(monkeypatch):
    from app.stress import DeterministicProvider
    monkeypatch.setattr("app.main.installed",lambda spec:True)
    used=[]
    def load(spec):used.append((spec.id,spec.version));return DeterministicProvider()
    monkeypatch.setattr("app.worker.load_provider",load)
    specific={**workspace,"poems":[{**workspace["poems"][0],"lines":[{"id":"l1","text":"погода"}]}]}
    project=client.post("/api/v1/projects",json={"name":"Stress","workspace":specific}).json()
    job=client.post(f'/api/v1/projects/{project["id"]}/stress/jobs',json={"poem_ids":["p"],"revision":1,"model_id":"silero-stress","model_version":"1.4"}).json()
    assert process_one()
    done=client.get(f'/api/v1/jobs/{job["id"]}').json();assert done["status"]=="succeeded"
    assert used==[("silero-stress","1.4")]
    saved=client.get(f'/api/v1/projects/{project["id"]}').json()
    assert saved["workspace"]["poems"][0]["lines"][0]["stressSuggestion"]["suggestedText"]=="пого`да"

def test_late_cancellation_never_applies_results(monkeypatch):
    from app.stress import DeterministicProvider,analyse_line as real_analyse
    monkeypatch.setattr("app.main.installed",lambda spec:True)
    monkeypatch.setattr("app.worker.load_provider",lambda spec:DeterministicProvider())
    specific={**workspace,"poems":[{**workspace["poems"][0],"lines":[{"id":"l1","text":"погода"}]}]}
    project=client.post("/api/v1/projects",json={"name":"Cancel","workspace":specific}).json()
    job=client.post(f'/api/v1/projects/{project["id"]}/stress/jobs',json={"poem_ids":["p"],"revision":1,"model_id":"silero-stress","model_version":"1.4"}).json()
    def cancel_during_analysis(text,provider):
        with SessionLocal.begin() as db:db.get(Job,UUID(job["id"])).status=JobStatus.cancel_requested
        return real_analyse(text,provider)
    monkeypatch.setattr("app.worker.analyse_line",cancel_during_analysis)
    assert process_one()
    assert client.get(f'/api/v1/jobs/{job["id"]}').json()["status"]=="cancelled"
    saved=client.get(f'/api/v1/projects/{project["id"]}').json()
    assert saved["revision"]==1 and "stressSuggestion" not in saved["workspace"]["poems"][0]["lines"][0]


def test_project_crud_exact_roundtrip_and_revision_errors():
    project = create()
    assert project["revision"] == 1 and project["workspace"] == workspace
    assert client.get(f'/api/v1/projects/{project["id"]}').json()["workspace"] == workspace
    assert "workspace" not in client.get("/api/v1/projects").json()[0]
    body = {"name": "Новое", "schema_version": 1, "revision": 1, "workspace": workspace}
    updated = client.put(f'/api/v1/projects/{project["id"]}', json=body)
    assert updated.status_code == 200 and updated.json()["revision"] == 2
    conflict = client.put(f'/api/v1/projects/{project["id"]}', json=body)
    assert_error(conflict, 409, "revision_conflict")
    assert conflict.json()["detail"]["current_revision"] == 2
    assert client.delete(f'/api/v1/projects/{project["id"]}').status_code == 204
    assert_error(client.get(f'/api/v1/projects/{project["id"]}'), 404, "project_not_found")


def test_workspace_summary_prefers_modified_over_dirty_and_cancel():
    project = create()
    job = client.post(f'/api/v1/projects/{project["id"]}/jobs', json={"type": "workspace_summary"}).json()
    assert job["status"] == "queued" and process_one()
    done = client.get(f'/api/v1/jobs/{job["id"]}').json()
    assert done["status"] == "succeeded"
    assert done["result"] == {"corpora": 1, "poems": 1, "verse_lines": 2, "modified_poems": 1, "statuses": {"ready": 1}, "revision": 1}
    queued = client.post(f'/api/v1/projects/{project["id"]}/jobs', json={"type": "workspace_summary"}).json()
    assert client.post(f'/api/v1/jobs/{queued["id"]}/cancel').json()["status"] == "cancelled"
    assert_error(client.post(f'/api/v1/jobs/{queued["id"]}/cancel'), 409, "job_state_conflict")


def test_claim_is_exclusive_and_stale_jobs_are_recovered_or_failed(monkeypatch):
    project = create()
    first = client.post(f'/api/v1/projects/{project["id"]}/jobs', json={"type": "workspace_summary"}).json()
    claimed = claim_job()
    assert str(claimed) == first["id"] and claim_job() is None
    with SessionLocal.begin() as db:
        job = db.get(Job, UUID(first["id"]))
        job.updated_at = utcnow() - timedelta(seconds=settings.job_lease_seconds + 1)
    recover_stale()
    with SessionLocal() as db:
        assert db.get(Job, UUID(first["id"])).status == JobStatus.queued
    monkeypatch.setattr(settings, "job_max_attempts", 1)
    claimed = claim_job()
    with SessionLocal.begin() as db:
        job = db.get(Job, claimed)
        job.updated_at = utcnow() - timedelta(seconds=settings.job_lease_seconds + 1)
    recover_stale()
    with SessionLocal() as db:
        assert db.scalar(select(Job).where(Job.id == claimed)).status == JobStatus.failed


def test_413_and_503_use_documented_safe_error_envelope(monkeypatch):
    monkeypatch.setattr(settings, "max_workspace_bytes", 100)
    too_large = client.post("/api/v1/projects", content=b"x" * 101, headers={"content-type": "application/json"})
    assert_error(too_large, 413, "payload_too_large")
    assert "9.53674e-05 MiB" in too_large.json()["detail"]["message"]

    class BrokenDatabase:
        def execute(self, _statement):
            raise RuntimeError("secret postgres host and password")

    def broken_database():
        yield BrokenDatabase()

    app.dependency_overrides[database] = broken_database
    try:
        unavailable = client.get("/api/v1/ready")
    finally:
        app.dependency_overrides.clear()
    assert_error(unavailable, 503, "database_unavailable")
    assert "secret" not in unavailable.text
