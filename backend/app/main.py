from fastapi import FastAPI

from .schemas import CapabilitiesResponse, HealthResponse
from .settings import settings

app = FastAPI(
    title="NCRL Poetic Marker API",
    version=settings.version,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)


@app.get("/api/v1/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    return HealthResponse(service=settings.service_name, version=settings.version)


@app.get("/api/v1/capabilities", response_model=CapabilitiesResponse, tags=["system"])
def capabilities() -> CapabilitiesResponse:
    return CapabilitiesResponse()
