import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  registers every model on Base.metadata
from app.core.security import hash_password
from app.db.base import Base
from app.db.seed import seed_permissions_and_roles, seed_school_settings, seed_system_settings
from app.db.session import get_db
from app.main import app as fastapi_app
from app.models.identity import Role, User


@pytest.fixture()
def db_session():
    """A throwaway in-memory SQLite DB per test — doc 03."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    testing_session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = testing_session_local()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def client(db_session: Session):
    def _override_get_db():
        yield db_session

    fastapi_app.dependency_overrides[get_db] = _override_get_db
    with TestClient(fastapi_app) as test_client:
        yield test_client
    fastapi_app.dependency_overrides.clear()


@pytest.fixture()
def seeded_db(db_session: Session):
    seed_school_settings(db_session)
    seed_system_settings(db_session)
    seed_permissions_and_roles(db_session)
    db_session.commit()
    return db_session


def create_user_with_role(db: Session, role_code: str, email: str, password: str = "Password123!") -> User:
    role = db.query(Role).filter(Role.code == role_code).one()
    user = User(
        id=str(uuid.uuid4()),
        email=email,
        password_hash=hash_password(password),
        status="active",
        must_change_password=False,
    )
    user.roles = [role]
    db.add(user)
    db.commit()
    return user


@pytest.fixture()
def login_as(client: TestClient, seeded_db: Session):
    """login_as("teacher") -> Authorization header dict for a fresh user with that role."""

    def _login(role_code: str, email: str | None = None) -> dict[str, str]:
        email = email or f"{role_code}@example.com"
        create_user_with_role(seeded_db, role_code, email)
        response = client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
        assert response.status_code == 200, response.text
        token = response.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    return _login
