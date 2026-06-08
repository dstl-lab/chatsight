import sys
import os

# Set dummy PG_PASSWORD before importing any app modules, since database.py
# reads this env var at module load time.
os.environ.setdefault("PG_PASSWORD", "test_dummy_password")

# The study week-lock (study_scope) is ON by default in production. The legacy
# test suite seeds unscoped MessageCache rows (notebook=None or other weeks), so
# disable the lock here. test_study_scope.py re-enables it per-test to validate it.
os.environ.setdefault("CHATSIGHT_STUDY_LOCK", "0")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine, Session
from sqlmodel.pool import StaticPool

import study_scope
from main import app, get_ext_conn
from database import get_session


@pytest.fixture(autouse=True)
def _clear_scope_cache():
    """Wipe the in_scope_keys memo cache before each test.

    Tests seed different numbers of MessageCache rows but may collide on the
    (lock_on, names, row_count) cache key when row counts happen to match.
    Clearing per-test gives isolation without coupling to any specific fixture."""
    study_scope._scope_cache.clear()
    yield
    study_scope._scope_cache.clear()


@pytest.fixture(name="engine")
def engine_fixture():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    yield engine
    SQLModel.metadata.drop_all(engine)


@pytest.fixture(name="session")
def session_fixture(engine):
    with Session(engine) as session:
        yield session


@pytest.fixture(name="client")
def client_fixture(session, monkeypatch):
    monkeypatch.setenv("CHATSIGHT_HYBRID_EXPLORE_FRACTION", "0")

    def override_session():
        yield session

    def override_ext_conn():
        # Tests that need the external DB either monkeypatch _fetch_conversation_events
        # or use app.dependency_overrides[get_ext_conn] directly. Yield None so
        # FastAPI can resolve the dependency without a real Postgres connection.
        yield None

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_ext_conn] = override_ext_conn
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()
