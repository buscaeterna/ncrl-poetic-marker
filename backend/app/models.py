import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON, Uuid

from .database import Base

JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")
UUID_TYPE = Uuid().with_variant(UUID(as_uuid=True), "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class JobStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200))
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    workspace: Mapped[dict] = mapped_column(JSON_TYPE)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    jobs: Mapped[list["Job"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID_TYPE, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(80))
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus, native_enum=False), default=JobStatus.queued, index=True)
    progress: Mapped[float] = mapped_column(Float, default=0)
    result: Mapped[dict | None] = mapped_column(JSON_TYPE, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    project: Mapped[Project] = relationship(back_populates="jobs")

Index("ix_jobs_claim", Job.status, Job.created_at)
