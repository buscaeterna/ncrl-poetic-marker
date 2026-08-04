from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    version: str


class CapabilitiesResponse(BaseModel):
    workspace: bool = False
    jobs: bool = False
    pdf: bool = False
    ocr: bool = False
    stress: bool = False
    meter: bool = False
    local_model: bool = False
