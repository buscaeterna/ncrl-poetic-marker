import fitz
from fastapi.testclient import TestClient
from app.main import app
from app.pdf import text_quality

client=TestClient(app)
def workspace(): return {"corpora":[],"poems":[],"activeId":None,"queue":[]}
def pdf_bytes(text="Большой синтетический русский текст для проверки цифрового слоя"):
    doc=fitz.open(); page=doc.new_page(); page.insert_text((72,72),text); data=doc.tobytes();doc.close();return data

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
