"""Import every model module here so Alembic autogenerate and
`Base.metadata.create_all` (tests) can discover all tables.
"""

from app.models.academics_core import (  # noqa: F401
    AcademicYear,
    ClassSubject,
    SchoolClass,
    Section,
    Subject,
    Term,
)
from app.models.identity import (  # noqa: F401
    AuditLog,
    Permission,
    RefreshToken,
    Role,
    RolePermission,
    SchoolSettings,
    SystemSetting,
    User,
    UserRole,
)
