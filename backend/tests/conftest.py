import pytest
from app.database import Base, engine
from app.settings import settings
@pytest.fixture(autouse=True)
def tables(tmp_path, monkeypatch):
    monkeypatch.setattr(settings,"models_dir",str(tmp_path/"models"))
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)
