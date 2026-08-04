import io
from pypdf import PdfWriter
from fastapi.testclient import TestClient
from app.main import app
from app.pdf import text_quality

client=TestClient(app)
def workspace(): return {"corpora":[],"poems":[],"activeId":None,"queue":[]}
def pdf_bytes(text="Большой синтетический русский текст для проверки цифрового слоя"):
    output=io.BytesIO(); writer=PdfWriter(); writer.add_blank_page(300,300); writer.write(output); return output.getvalue()

def test_quality_heuristic():
    assert text_quality("Это достаточно длинный корректный русский текст для страницы")[0]
    assert not text_quality("�\x00")[0]

def test_pdf_upload_signature_order_and_revision(tmp_path, monkeypatch):
    monkeypatch.setattr("app.settings.settings.files_dir",str(tmp_path))
    project=client.post("/api/v1/projects",json={"name":"p","workspace":workspace()}).json()
    bad=client.post(f"/api/v1/projects/{project['id']}/sources",files={"file":("fake.pdf",b"not pdf","application/pdf")},data={"upload_order":"0"})
    assert bad.status_code==415
    good=client.post(f"/api/v1/projects/{project['id']}/sources",files={"file":("author.pdf",pdf_bytes(),"application/pdf")},data={"upload_order":"2"})
    assert good.status_code==201
    source=good.json(); assert source["original_name"]=="author.pdf" and source["page_count"]==1 and source["upload_order"]==2
    assert client.post(f"/api/v1/sources/{source['id']}/extract").status_code==202

def test_tesseract_tsv_preserves_verse_lines_and_stanzas():
    from app.pdf import tsv_text
    head="level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"
    rows=["5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t95\tПервая","5\t1\t1\t1\t1\t2\t0\t0\t1\t1\t90\tстрока","5\t1\t1\t1\t2\t1\t0\t0\t1\t1\t85\tВторая","5\t1\t1\t2\t1\t1\t0\t0\t1\t1\t80\tНовая","5\t1\t1\t2\t1\t2\t0\t0\t1\t1\t75\tстрофа"]
    text, confidence=tsv_text("\n".join([head,*rows]))
    assert text == "Первая строка\nВторая\n\nНовая строфа"
    assert confidence == 85

def test_page_validation_approval_guards_and_background_ocr(tmp_path, monkeypatch):
    from app.database import SessionLocal
    from app.models import Project, SourceDocument, SourcePage
    import uuid
    monkeypatch.setattr("app.settings.settings.files_dir",str(tmp_path))
    with SessionLocal.begin() as db:
        project=Project(name="pdf",schema_version=1,workspace=workspace());db.add(project);db.flush()
        document=SourceDocument(project_id=project.id,original_name="scan.pdf",storage_key=f"{uuid.uuid4()}/scan.pdf",mime_type="application/pdf",size=1,sha256="0"*64,upload_order=0,page_count=2,status="review")
        db.add(document);db.flush();page=SourcePage(document_id=document.id,page_number=1,method="ocr",raw_text="raw",edited_text="manual",ocr_text="old",warnings=[]);db.add(page);db.flush();did,pid,revision=document.id,page.id,page.revision
    assert client.patch(f"/api/v1/sources/{did}/pages/1",json={"revision":revision,"review_status":"invalid"}).status_code==422
    assert client.post(f"/api/v1/sources/{did}/approve").status_code==409
    response=client.post(f"/api/v1/sources/{did}/pages/1/ocr?revision={revision}")
    assert response.status_code==202
    with SessionLocal() as db:
        stored=db.get(SourcePage,pid);assert stored.edited_text=="manual" and stored.ocr_text=="old"

def test_document_list_exposes_its_exact_job_and_progress():
    from app.database import SessionLocal
    from app.models import Job, SourceDocument
    project=client.post("/api/v1/projects",json={"name":"jobs","workspace":workspace()}).json()
    import uuid
    with SessionLocal.begin() as db:
        job=Job(project_id=uuid.UUID(project["id"]),type="pdf_extract",progress=.5);db.add(job);db.flush()
        doc=SourceDocument(project_id=uuid.UUID(project["id"]),extraction_job_id=job.id,original_name="a.pdf",storage_key=f"{uuid.uuid4()}/a.pdf",mime_type="application/pdf",size=1,sha256="0"*64,upload_order=0,page_count=2,status="extracting");db.add(doc);db.flush();job_id=str(job.id)
    source=client.get(f"/api/v1/projects/{project['id']}/sources").json()[0]
    assert str(source["job"]["id"])==job_id and source["job"]["progress"]==.5
