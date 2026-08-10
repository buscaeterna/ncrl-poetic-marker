"""Trusted model installation and loading; user supplied URLs are never accepted."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import threading
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

from .settings import settings

@dataclass(frozen=True)
class ModelSpec:
    id: str; version: str; provider: str; filename: str; url: str; size: int; sha256: str
    license: str; source_commit: str

SILERO = ModelSpec(
    id="silero-stress", version="1.4", provider="silero", filename="silero_stress-1.4-py3-none-any.whl",
    url="https://files.pythonhosted.org/packages/ba/72/5edf26c74a8d48640108976db5bc3e9e59722b63ccaa36b21894bf79ad77/silero_stress-1.4-py3-none-any.whl",
    size=38_587_594, sha256="c772725dc03c647e2b33961280dc35f41b7f43ac0861575884fea0c2a6cb8ae2",
    license="MIT", source_commit="76706c123dc9ac0ca0b2b428d132a71c6cc4ff36")
MANIFEST = {(SILERO.id, SILERO.version): SILERO}
_locks = {key: threading.Lock() for key in MANIFEST}
_claims_lock = threading.Lock()

def root() -> Path:
    path=Path(settings.models_dir).resolve(); path.mkdir(parents=True,exist_ok=True)
    return path

def directory(spec: ModelSpec) -> Path: return root() / f"{spec.id}-{spec.version}"
def status_path(spec: ModelSpec) -> Path: return root() / f".{spec.id}-{spec.version}.json"

def _write_status(spec: ModelSpec, state: str, progress: float=0, error: str|None=None):
    temporary=status_path(spec).with_suffix(".json.tmp")
    temporary.write_text(json.dumps({"state":state,"progress":progress,"error":error,"pid":os.getpid()}),encoding="utf-8")
    os.replace(temporary,status_path(spec))

def claim_install(spec: ModelSpec) -> bool:
    """Reserve an installation before a request begins transferring bytes."""
    with _claims_lock:
        if state(spec)["state"] == "installing": return False
        _write_status(spec,"installing",0)
        return True

def fail_install(spec: ModelSpec, error: Exception):
    _write_status(spec,"error",0,str(error))

def verify_file(path: Path, spec: ModelSpec):
    if path.stat().st_size != spec.size: raise ValueError("model size mismatch")
    digest=hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b""): digest.update(chunk)
    if digest.hexdigest() != spec.sha256: raise ValueError("model SHA-256 mismatch")

def installed(spec: ModelSpec) -> bool:
    marker=directory(spec)/"manifest.json"; model=directory(spec)/"silero_stress"/"data"/"accentor.pt"
    artifact=directory(spec)/spec.filename
    if not marker.is_file() or not model.is_file() or not artifact.is_file(): return False
    try:
        if json.loads(marker.read_text())["sha256"] != spec.sha256:return False
        verify_file(artifact,spec);return True
    except (OSError,KeyError,ValueError,json.JSONDecodeError): return False

def state(spec: ModelSpec) -> dict:
    present=installed(spec)
    value={"state":"installed" if present else "not_installed","progress":1 if present else 0,"error":None}
    try: value.update(json.loads(status_path(spec).read_text()))
    except (OSError,json.JSONDecodeError): pass
    if value["state"]=="installing" and value.get("pid")!=os.getpid():
        (root()/f".{spec.filename}.part").unlink(missing_ok=True)
        shutil.rmtree(root()/f".{spec.id}-{spec.version}.staging",ignore_errors=True)
        _write_status(spec,"error",0,"incomplete installation was interrupted")
        value={"state":"error","progress":0,"error":"incomplete installation was interrupted"}
    if value["state"]=="installed" and not installed(spec): value={"state":"error","progress":0,"error":"model files are missing or damaged"}
    value.pop("pid",None)
    return {**spec.__dict__,**value}

def _extract(wheel: Path, target: Path, spec: ModelSpec):
    staging=root()/f".{spec.id}-{spec.version}.staging"; shutil.rmtree(staging,ignore_errors=True);staging.mkdir()
    try:
        with zipfile.ZipFile(wheel) as archive:
            members=[m for m in archive.infolist() if m.filename.startswith("silero_stress/") and not m.is_dir()]
            if not members or any(".." in Path(m.filename).parts for m in members): raise ValueError("invalid model archive")
            for member in members:
                destination=(staging/member.filename).resolve()
                if staging.resolve() not in destination.parents: raise ValueError("unsafe model archive path")
                destination.parent.mkdir(parents=True,exist_ok=True)
                with archive.open(member) as source,destination.open("wb") as output: shutil.copyfileobj(source,output)
        shutil.copyfile(wheel,staging/spec.filename)
        (staging/"manifest.json").write_text(json.dumps(spec.__dict__,sort_keys=True),encoding="utf-8")
        shutil.rmtree(target,ignore_errors=True);os.replace(staging,target)
    except Exception: shutil.rmtree(staging,ignore_errors=True);raise

def install(spec: ModelSpec, source: Path|None=None):
    with _locks.setdefault((spec.id,spec.version),threading.Lock()):
        part=root()/f".{spec.filename}.part"; _write_status(spec,"installing",0)
        try:
            if source:
                shutil.copyfile(source,part);_write_status(spec,"installing",.8)
            else:
                request=urllib.request.Request(spec.url,headers={"User-Agent":"ncrl-poetic-marker/model-installer"})
                with urllib.request.urlopen(request,timeout=30) as response,part.open("wb") as output:
                    read=0
                    while chunk:=response.read(1024*1024):
                        read+=len(chunk)
                        if read>spec.size: raise ValueError("model exceeds trusted size")
                        output.write(chunk);_write_status(spec,"installing",min(.8,read/spec.size*.8))
            verify_file(part,spec);_extract(part,directory(spec),spec);_write_status(spec,"installed",1)
        except Exception as exc:
            _write_status(spec,"error",0,str(exc));raise
        finally: part.unlink(missing_ok=True)

def remove(spec: ModelSpec):
    with _locks.setdefault((spec.id,spec.version),threading.Lock()): shutil.rmtree(directory(spec),ignore_errors=True);_write_status(spec,"not_installed",0)

def get_spec(model_id: str, version: str) -> ModelSpec:
    try:return MANIFEST[(model_id,version)]
    except KeyError as exc: raise ValueError("unknown trusted model") from exc

def load_provider(spec: ModelSpec):
    if not installed(spec): raise ValueError("model is not installed or is damaged")
    path=str(directory(spec));
    if path not in sys.path:sys.path.insert(0,path)
    from .stress import SileroProvider
    return SileroProvider(spec.version)
