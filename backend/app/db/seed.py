"""Idempotent seed script — doc 18 §B lists every system_settings default.

Run with: uv run python -m app.db.seed
"""

import logging
from datetime import date
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import PERMISSIONS, ROLE_DEFINITIONS, ROLE_PERMISSIONS
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.academics_core import AcademicYear, SchoolClass, Section, Term
from app.models.identity import Permission, Role, SchoolSettings, SystemSetting, User

logger = logging.getLogger("edumanage.seed")

# key -> (value, value_type, category, description)
SYSTEM_SETTINGS_DEFAULTS: dict[str, tuple[str, str, str, str]] = {
    "currency_code": ("USD", "string", "Finance", "Currency for all fee amounts (doc 01 Regional context)"),
    "fee_discount_approval_threshold_cents": (
        "0",
        "integer",
        "Finance",
        "Discounts at/above this amount require Principal/Admin approval — "
        "confirm real value with school (doc 18 §B)",
    ),
    "attendance_edit_lock_hours": (
        "24",
        "integer",
        "Attendance",
        "Hours a teacher can self-correct attendance",
    ),
    "absenteeism_consecutive_absences_trigger": (
        "3",
        "integer",
        "Attendance",
        "Consecutive absences that raise an absenteeism flag",
    ),
    "absenteeism_rate_trigger_pct": (
        "0",
        "decimal",
        "Attendance",
        "Attendance rate (%) below which a flag is raised — 0 disables this trigger; confirm with school",
    ),
    "academic_at_risk_threshold_pct": (
        "50",
        "decimal",
        "Academics",
        "Weighted average (%) below which a student is flagged at-risk — "
        "confirm real value with school (doc 18 §B)",
    ),
    "class_ranking_enabled": ("false", "boolean", "Academics", "Whether class rank is computed/shown"),
    "teacher_fee_status_visibility": (
        "false",
        "boolean",
        "Finance",
        "Whether teachers see a simple fee current/overdue flag (privacy, off by default)",
    ),
    "password_min_length": ("10", "integer", "Security", "Minimum password length enforced server-side"),
    "backup_retention_daily_days": ("30", "integer", "Ops", "Days to retain daily backups"),
    "backup_retention_weekly_weeks": ("26", "integer", "Ops", "Weeks to retain weekly backups"),
}


def seed_system_settings(db: Session) -> None:
    for key, (value, value_type, category, description) in SYSTEM_SETTINGS_DEFAULTS.items():
        existing = db.scalar(select(SystemSetting).where(SystemSetting.key == key))
        if existing is not None:
            continue
        db.add(
            SystemSetting(
                id=str(uuid4()),
                key=key,
                value=value,
                value_type=value_type,
                category=category,
                description=description,
            )
        )
    db.flush()
    logger.info("system_settings seeded")


def seed_school_settings(db: Session) -> None:
    existing = db.scalar(select(SchoolSettings))
    if existing is not None:
        return
    db.add(
        SchoolSettings(
            id=str(uuid4()),
            name="EduManage Demo Primary School",
            timezone="Africa/Harare",
        )
    )
    db.flush()
    logger.info("school_settings seeded")


def seed_permissions_and_roles(db: Session) -> None:
    code_to_permission: dict[str, Permission] = {}
    for code, description in PERMISSIONS.items():
        existing = db.scalar(select(Permission).where(Permission.code == code))
        if existing is None:
            existing = Permission(id=str(uuid4()), code=code, description=description)
            db.add(existing)
        code_to_permission[code] = existing
    db.flush()

    for role_code, description in ROLE_DEFINITIONS.items():
        role = db.scalar(select(Role).where(Role.code == role_code))
        if role is None:
            role = Role(
                id=str(uuid4()),
                code=role_code,
                name=role_code.replace("_", " ").title(),
                description=description,
                is_system_role=True,
            )
            db.add(role)
            db.flush()

        wanted_codes = set(ROLE_PERMISSIONS.get(role_code, []))
        current_codes = {p.code for p in role.permissions}
        if wanted_codes != current_codes:
            role.permissions = [code_to_permission[c] for c in wanted_codes]
            db.flush()

    logger.info(
        "roles + permissions seeded (%d roles, %d permissions)", len(ROLE_DEFINITIONS), len(PERMISSIONS)
    )


def seed_academic_calendar(db: Session) -> AcademicYear:
    existing = db.scalar(select(AcademicYear).where(AcademicYear.is_current == True))  # noqa: E712
    if existing is not None:
        return existing

    today = date.today()
    year = AcademicYear(
        id=str(uuid4()),
        name=str(today.year),
        start_date=date(today.year, 1, 1),
        end_date=date(today.year, 12, 31),
        is_current=True,
    )
    db.add(year)
    db.flush()

    for i, name in enumerate(["Term 1", "Term 2", "Term 3"], start=1):
        db.add(Term(id=str(uuid4()), academic_year_id=year.id, term_number=i, name=name))
    db.flush()
    logger.info("demo academic year + 3-term template seeded")
    return year


def seed_demo_class(db: Session) -> None:
    existing = db.scalar(select(SchoolClass))
    if existing is not None:
        return
    grade1 = SchoolClass(id=str(uuid4()), name="Grade 1", level_order=1)
    db.add(grade1)
    db.flush()
    db.add(Section(id=str(uuid4()), class_id=grade1.id, name="Grade 1 A", capacity=35))
    db.flush()
    logger.info("demo class 'Grade 1' + section 'Grade 1 A' seeded")


_DEFAULT_ADMIN_PASSWORD = "ChangeMe123!"


def seed_admin_user(db: Session) -> None:
    admin_email = settings.admin_email
    if settings.environment != "development" and settings.admin_password == _DEFAULT_ADMIN_PASSWORD:
        raise RuntimeError(
            "ADMIN_PASSWORD is still the placeholder default — set a real value in .env "
            "before seeding a non-development environment."
        )

    existing = db.scalar(select(User).where(User.email == admin_email))
    if existing is not None:
        return
    admin_role = db.scalar(select(Role).where(Role.code == "admin"))
    if admin_role is None:
        raise RuntimeError("admin role must be seeded before the admin user")

    user = User(
        id=str(uuid4()),
        email=admin_email,
        password_hash=hash_password(settings.admin_password),
        status="active",
        must_change_password=True,
    )
    user.roles = [admin_role]
    db.add(user)
    db.flush()
    logger.warning(
        "Admin user created: %s — must_change_password is set, so this password "
        "must be rotated on first login.",
        admin_email,
    )


def run_seed(db: Session) -> None:
    seed_school_settings(db)
    seed_system_settings(db)
    seed_permissions_and_roles(db)
    seed_academic_calendar(db)
    seed_demo_class(db)
    seed_admin_user(db)
    db.commit()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    session = SessionLocal()
    try:
        run_seed(session)
    finally:
        session.close()
