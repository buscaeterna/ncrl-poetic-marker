import pytest
from app.database import Base, engine
@pytest.fixture(autouse=True)
def tables():
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)
