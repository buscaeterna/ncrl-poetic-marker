from fastapi.testclient import TestClient
from app.main import app
from app.worker import process_one
client=TestClient(app)
workspace={"corpora":[{"id":"c","originalSource":"x\r\nя","future":{"x":1}}],"poems":[{"id":"p","lines":[{"text":"a"},{"text":"b"}],"status":"ready","dirty":True}],"activeId":"p","queue":["p"],"future":True}

def create():
    r=client.post("/api/v1/projects",json={"name":"Тест","workspace":workspace}); assert r.status_code==201; return r.json()

def test_health_capabilities_openapi():
    assert client.get("/api/v1/health").status_code==200
    assert client.get("/api/v1/ready").status_code==200
    assert client.get("/api/v1/capabilities").json()=={"workspace":True,"jobs":True,"pdf":False,"ocr":False,"stress":False,"meter":False,"local_model":False}
    assert "/api/v1/projects" in client.get("/api/openapi.json").json()["paths"]

def test_project_crud_roundtrip_unknown_fields_and_revision():
    p=create(); assert p["revision"]==1 and p["workspace"]==workspace
    listing=client.get("/api/v1/projects").json(); assert "workspace" not in listing[0]
    body={"name":"Новое","schema_version":1,"revision":1,"workspace":workspace}
    updated=client.put(f'/api/v1/projects/{p["id"]}',json=body); assert updated.status_code==200 and updated.json()["revision"]==2
    conflict=client.put(f'/api/v1/projects/{p["id"]}',json=body); assert conflict.status_code==409 and conflict.json()["detail"]["code"]=="revision_conflict"
    assert client.delete(f'/api/v1/projects/{p["id"]}').status_code==204
    assert client.get(f'/api/v1/projects/{p["id"]}').status_code==404

def test_jobs_success_cancel_and_summary():
    p=create(); j=client.post(f'/api/v1/projects/{p["id"]}/jobs',json={"type":"workspace_summary"}).json()
    assert j["status"]=="queued" and process_one()
    done=client.get(f'/api/v1/jobs/{j["id"]}').json(); assert done["status"]=="succeeded"
    assert done["result"]=={"corpora":1,"poems":1,"verse_lines":2,"modified_poems":1,"statuses":{"ready":1},"revision":1}
    queued=client.post(f'/api/v1/projects/{p["id"]}/jobs',json={"type":"workspace_summary"}).json()
    assert client.post(f'/api/v1/jobs/{queued["id"]}/cancel').json()["status"]=="cancelled"
    assert client.post(f'/api/v1/jobs/{queued["id"]}/cancel').status_code==409

def test_unknown_project():
    assert client.get('/api/v1/projects/00000000-0000-0000-0000-000000000000').status_code==404
