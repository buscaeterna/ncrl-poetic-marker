import hashlib,zipfile
import json
from pathlib import Path
import pytest
from app.model import ModelSpec, install, installed, remove, state, verify_file

def fixture(tmp_path:Path):
    wheel=tmp_path/'trusted.whl'
    with zipfile.ZipFile(wheel,'w') as archive:
        archive.writestr('silero_stress/__init__.py','')
        archive.writestr('silero_stress/data/accentor.pt',b'model')
    data=wheel.read_bytes()
    return wheel,ModelSpec('fixture','1','silero','trusted.whl','https://invalid.example',len(data),hashlib.sha256(data).hexdigest(),'MIT','commit')

def test_offline_install_verify_persist_and_remove(tmp_path):
    wheel,spec=fixture(tmp_path);install(spec,wheel)
    assert installed(spec) and state(spec)['state']=='installed'
    remove(spec);assert not installed(spec)

def test_bad_sha_never_installs_and_part_is_cleaned(tmp_path):
    wheel,spec=fixture(tmp_path);bad=ModelSpec(**{**spec.__dict__,'sha256':'0'*64})
    with pytest.raises(ValueError,match='SHA-256'):install(bad,wheel)
    assert state(bad)['state']=='error' and not installed(bad)
    assert not list(Path(tmp_path/'models').glob('.*.part'))

def test_corruption_is_not_installed(tmp_path):
    wheel,spec=fixture(tmp_path);install(spec,wheel)
    from app.model import directory
    (directory(spec)/spec.filename).write_bytes(b'bad')
    assert not installed(spec) and state(spec)['state']=='error'

def test_interrupted_install_is_explicit_error_and_part_is_removed(tmp_path):
    wheel,spec=fixture(tmp_path)
    from app.model import root,status_path
    part=root()/f'.{spec.filename}.part';part.write_bytes(b'incomplete')
    status_path(spec).write_text(json.dumps({'state':'installing','progress':.2,'pid':-1}))
    assert state(spec)['state']=='error'
    assert not part.exists()
