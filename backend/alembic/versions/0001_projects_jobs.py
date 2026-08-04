"""projects and PostgreSQL job queue"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision = "0001"
down_revision = None

def upgrade():
    status = sa.Enum("queued", "running", "succeeded", "failed", "cancelled", name="jobstatus", native_enum=False)
    op.create_table("projects", sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True), sa.Column("name", sa.String(200), nullable=False), sa.Column("schema_version", sa.Integer, nullable=False), sa.Column("workspace", postgresql.JSONB, nullable=False), sa.Column("revision", sa.Integer, nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("jobs", sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True), sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False), sa.Column("type", sa.String(80), nullable=False), sa.Column("status", status, nullable=False), sa.Column("progress", sa.Float, nullable=False), sa.Column("result", postgresql.JSONB), sa.Column("error", sa.Text), sa.Column("attempts", sa.Integer, nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("started_at", sa.DateTime(timezone=True)), sa.Column("finished_at", sa.DateTime(timezone=True)), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_jobs_project_id", "jobs", ["project_id"]); op.create_index("ix_jobs_status", "jobs", ["status"]); op.create_index("ix_jobs_claim", "jobs", ["status", "created_at"])

def downgrade():
    op.drop_table("jobs"); op.drop_table("projects")
