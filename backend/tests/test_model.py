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

def test_concurrent_install_claim_rejects_second_request(tmp_path):
    import threading
    from app.model import claim_install
    _,spec=fixture(tmp_path)
    barrier=threading.Barrier(3);results=[]
    def reserve():
        barrier.wait();results.append(claim_install(spec))
    threads=[threading.Thread(target=reserve) for _ in range(2)]
    for thread in threads:thread.start()
    barrier.wait()
    for thread in threads:thread.join()
    assert sorted(results)==[False,True]
    assert state(spec)['state']=='installing'

def test_concurrent_offline_import_request_is_rejected_and_upload_is_cleaned(tmp_path,monkeypatch):
    import threading
    from fastapi.testclient import TestClient
    import app.main as main
    wheel,spec=fixture(tmp_path);entered=threading.Event();release=threading.Event();responses=[]
    monkeypatch.setattr(main,"get_spec",lambda _model_id,_version:spec)
    real_install=install
    def blocked_install(selected,source=None):
        entered.set();assert release.wait(5);return real_install(selected,source)
    monkeypatch.setattr(main,"install",blocked_install)
    client=TestClient(main.app)
    def first():responses.append(client.post(f"/api/v1/stress/models/{spec.id}/{spec.version}/import",files={"file":(spec.filename,wheel.read_bytes(),"application/octet-stream")}))
    thread=threading.Thread(target=first);thread.start();assert entered.wait(5)
    duplicate=client.post(f"/api/v1/stress/models/{spec.id}/{spec.version}/import",files={"file":(spec.filename,wheel.read_bytes(),"application/octet-stream")})
    assert duplicate.status_code==409 and duplicate.json()["detail"]["code"]=="model_installing"
    release.set();thread.join(5)
    assert responses[0].status_code==202
    assert not list((tmp_path/"models").glob("*.upload"))
