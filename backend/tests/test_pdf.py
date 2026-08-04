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
