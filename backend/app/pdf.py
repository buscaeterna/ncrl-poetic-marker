"""Permissively licensed, local-only PDF extraction and OCR primitives."""
import re
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path

import pypdfium2 as pdfium
from pypdf import PdfReader

from .settings import settings

def safe_path(key: str) -> Path:
    root = Path(settings.files_dir).resolve(); path = (root / key).resolve()
    if root not in path.parents: raise ValueError("unsafe storage key")
    return path

def text_quality(text: str) -> tuple[bool, list[str]]:
    letters = re.findall(r"[A-Za-zА-Яа-яЁё]", text)
    bad = text.count("�") + sum(ord(c) < 32 and c not in "\n\r\t" for c in text)
    warnings = []
    if len(letters) < 20: warnings.append("Слишком мало букв в текстовом слое")
    if bad > max(2, len(text) // 100): warnings.append("Текстовый слой содержит повреждённые символы")
    return not warnings, warnings

def inspect_pdf(path: Path) -> int:
    try:
        reader = PdfReader(path)
        if reader.is_encrypted: raise PermissionError("PDF защищён паролем; зашифрованные PDF пока не поддерживаются")
        return len(reader.pages)
    except PermissionError: raise
    except Exception as exc: raise ValueError("Повреждённый или неподдерживаемый PDF") from exc

def tsv_text(tsv: str) -> tuple[str, float | None]:
    """Restore Tesseract block/paragraph/line structure without joining hyphens."""
    lines: dict[tuple[int,int,int], list[str]] = defaultdict(list); scores=[]
    for raw in tsv.splitlines()[1:]:
        row=raw.split("\t")
        if len(row)<12 or not row[11].strip(): continue
        key=(int(row[2]),int(row[3]),int(row[4])); lines[key].append(row[11])
        try:
            score=float(row[10])
            if score>=0: scores.append(score)
        except ValueError: pass
    output=[]; previous=None
    for key, words in sorted(lines.items()):
        paragraph=key[:2]
        if previous is not None and paragraph != previous: output.append("")
        output.append(" ".join(words)); previous=paragraph
    return "\n".join(output), sum(scores)/len(scores) if scores else None

def extract_page(path: Path, number: int, preview: Path, force_ocr=False) -> dict:
    reader=PdfReader(path); embedded=reader.pages[number-1].extract_text() or ""; usable,warnings=text_quality(embedded)
    pdf=pdfium.PdfDocument(path); page=pdf[number-1]
    width,height=page.get_size(); scale=settings.pdf_render_dpi/72
    if width*height*scale*scale>settings.pdf_max_pixels:
        scale=(settings.pdf_max_pixels/(width*height))**.5; warnings.append("Разрешение preview ограничено")
    bitmap=page.render(scale=scale, rotation=page.get_rotation()); image=bitmap.to_pil()
    preview.parent.mkdir(parents=True,exist_ok=True); image.save(preview)
    ocr=confidence=None
    if force_ocr or not usable:
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/"page.png"; image.save(source)
            proc=subprocess.run(["tesseract",str(source),"stdout","-l","rus+eng","--psm","6","tsv"],capture_output=True,text=True,timeout=settings.ocr_page_timeout_seconds,check=True)
            ocr,confidence=tsv_text(proc.stdout); warnings.append("OCR требует обязательной ручной проверки")
    chosen=ocr if force_ocr or not usable else embedded
    return {"embedded":embedded,"ocr":ocr,"text":chosen or "","method":"ocr" if force_ocr or not usable else "embedded_text","confidence":confidence,"warnings":warnings,"rotation":page.get_rotation()*90}
