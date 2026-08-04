"""Local-only PDF extraction primitives. No function in this module uses a network API."""
import re
import subprocess
import tempfile
from pathlib import Path

import fitz

from .settings import settings

def safe_path(key: str) -> Path:
    root = Path(settings.files_dir).resolve()
    path = (root / key).resolve()
    if root not in path.parents:
        raise ValueError("unsafe storage key")
    return path

def text_quality(text: str) -> tuple[bool, list[str]]:
    letters = re.findall(r"[A-Za-zА-Яа-яЁё]", text)
    bad = text.count("�") + sum(ord(c) < 32 and c not in "\n\r\t" for c in text)
    warnings = []
    if len(letters) < 20: warnings.append("Слишком мало букв в текстовом слое")
    if bad > max(2, len(text) // 100): warnings.append("Текстовый слой содержит повреждённые символы")
    return not warnings, warnings

def inspect_pdf(path: Path) -> tuple[int, bool]:
    try:
        doc = fitz.open(path)
        if doc.needs_pass: raise PermissionError("PDF защищён паролем; зашифрованные PDF пока не поддерживаются")
        count = len(doc)
        doc.close()
        return count, False
    except PermissionError: raise
    except Exception as exc: raise ValueError("Повреждённый или неподдерживаемый PDF") from exc

def extract_page(path: Path, number: int, preview: Path, force_ocr: bool = False) -> dict:
    with fitz.open(path) as doc:
        page = doc[number - 1]
        embedded = page.get_text("text")
        usable, warnings = text_quality(embedded)
        scale = settings.pdf_render_dpi / 72
        pixels = int(page.rect.width * scale) * int(page.rect.height * scale)
        if pixels > settings.pdf_max_pixels:
            scale *= (settings.pdf_max_pixels / pixels) ** .5
            warnings.append("Разрешение preview ограничено")
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        preview.parent.mkdir(parents=True, exist_ok=True)
        pix.save(preview)
        ocr = None
        confidence = None
        if force_ocr or not usable:
            with tempfile.TemporaryDirectory() as tmp:
                image = Path(tmp) / "page.png"; pix.save(image)
                proc = subprocess.run(
                    ["tesseract", str(image), "stdout", "-l", "rus+eng", "--psm", "6", "tsv"],
                    capture_output=True, text=True, timeout=settings.ocr_page_timeout_seconds, check=True,
                )
                rows = [line.split("\t") for line in proc.stdout.splitlines()[1:]]
                words = [r for r in rows if len(r) >= 12 and r[11].strip()]
                ocr = " ".join(r[11] for r in words)
                scores = [float(r[10]) for r in words if float(r[10]) >= 0]
                confidence = sum(scores) / len(scores) if scores else None
                warnings.append("OCR требует обязательной ручной проверки")
        chosen = ocr if (force_ocr or not usable) else embedded
        return {"embedded": embedded, "ocr": ocr, "text": chosen or "", "method": "ocr" if (force_ocr or not usable) else "embedded_text", "confidence": confidence, "warnings": warnings, "rotation": page.rotation}
