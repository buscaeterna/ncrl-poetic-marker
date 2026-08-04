from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "ncrl-poetic-marker-api", "version": "0.1.0"}


def test_capabilities_are_not_overstated() -> None:
    response = client.get("/api/v1/capabilities")
    assert response.status_code == 200
    assert response.json() == {name: False for name in ("workspace", "jobs", "pdf", "ocr", "stress", "meter", "local_model")}


def test_openapi_and_docs() -> None:
    schema = client.get("/api/openapi.json")
    assert schema.status_code == 200
    assert "/api/v1/health" in schema.json()["paths"]
    assert client.get("/api/docs").status_code == 200
