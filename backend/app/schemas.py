from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    version: str


class CapabilitiesResponse(BaseModel):
    workspace: bool = True
    jobs: bool = True
    pdf: bool = True
    ocr: bool = True
    stress: bool = False
    meter: bool = False
    local_model: bool = False


class Workspace(BaseModel):
    model_config = ConfigDict(extra="allow")
    corpora: list[Any]
    poems: list[Any]
    activeId: str | None
    queue: list[str]


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    schema_version: int = Field(default=1, ge=1)
    workspace: Workspace


class ProjectUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    schema_version: int = Field(default=1, ge=1)
    workspace: Workspace
    revision: int = Field(ge=1)


class ProjectSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    schema_version: int
    revision: int
    created_at: datetime
    updated_at: datetime


class ProjectDetail(ProjectSummary):
    workspace: dict[str, Any]


class JobCreate(BaseModel):
    type: Literal["workspace_summary", "pdf_extract"]


class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID
    type: str
    status: str
    progress: float
    result: dict[str, Any] | None
    error: str | None
    attempts: int
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    updated_at: datetime


class ErrorResponse(BaseModel):
    code: str
    message: str
    current_revision: int | None = None


class ErrorEnvelope(BaseModel):
    detail: ErrorResponse
