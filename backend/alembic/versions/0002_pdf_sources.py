"""persistent PDF source documents and pages"""
from alembic import op
import sqlalchemy as sa

revision = "0002_pdf_sources"
down_revision = "0001"
branch_labels = depends_on = None

def upgrade():
    # 0001 used an unconstrained VARCHAR-backed SQLAlchemy Enum. Constrain the
    # complete lifecycle now, including cooperative cancellation.
    op.alter_column("jobs", "status", existing_type=sa.String(length=9), type_=sa.String(length=32), existing_nullable=False)
    op.create_check_constraint("jobstatus", "jobs", "status IN ('queued','running','succeeded','failed','cancelled','cancel_requested')")
    op.create_table("source_documents", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False), sa.Column("extraction_job_id", sa.Uuid(), sa.ForeignKey("jobs.id", ondelete="SET NULL")), sa.Column("original_name", sa.String(500), nullable=False), sa.Column("storage_key", sa.String(100), nullable=False, unique=True), sa.Column("mime_type", sa.String(100), nullable=False), sa.Column("size", sa.Integer(), nullable=False), sa.Column("sha256", sa.String(64), nullable=False), sa.Column("upload_order", sa.Integer(), nullable=False), sa.Column("page_count", sa.Integer(), nullable=False), sa.Column("kind", sa.String(30)), sa.Column("status", sa.String(30), nullable=False), sa.Column("error", sa.Text()), sa.Column("revision", sa.Integer(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_source_documents_project_id", "source_documents", ["project_id"])
    op.create_table("source_pages", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("document_id", sa.Uuid(), sa.ForeignKey("source_documents.id", ondelete="CASCADE"), nullable=False), sa.Column("page_number", sa.Integer(), nullable=False), sa.Column("method", sa.String(30)), sa.Column("raw_text", sa.Text(), nullable=False), sa.Column("edited_text", sa.Text(), nullable=False), sa.Column("embedded_text", sa.Text()), sa.Column("ocr_text", sa.Text()), sa.Column("confidence", sa.Float()), sa.Column("warnings", sa.JSON(), nullable=False), sa.Column("review_status", sa.String(30), nullable=False), sa.Column("rotation", sa.Integer(), nullable=False), sa.Column("preview_key", sa.String(150)), sa.Column("revision", sa.Integer(), nullable=False), sa.UniqueConstraint("document_id", "page_number", name="ux_source_page_number"))
    op.create_index("ix_source_pages_document_id", "source_pages", ["document_id"])
def downgrade():
    op.drop_table("source_pages"); op.drop_table("source_documents")
    op.drop_constraint("jobstatus", "jobs", type_="check")
    op.execute("UPDATE jobs SET status='cancelled' WHERE status='cancel_requested'")
    op.alter_column("jobs", "status", existing_type=sa.String(length=32), type_=sa.String(length=9), existing_nullable=False)
