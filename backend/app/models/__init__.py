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
from app.models.attendance import (  # noqa: F401
    AbsenteeismFlag,
    AttendanceDailySummary,
    AttendanceRecord,
    AttendanceSession,
    ExcuseRequest,
)
from app.models.fee_financial import (  # noqa: F401
    Discount,
    FeeCategory,
    FeeCredit,
    FeeCreditApplication,
    FeeInvoice,
    FeeLedger,
    FeePayment,
    FeePaymentAllocation,
    FeeStructure,
    Receipt,
    StudentDiscount,
    StudentFeeOverride,
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
from app.models.staff_management import (  # noqa: F401
    Staff,
    StaffAssignment,
    StaffAttendance,
    StaffDocument,
)
from app.models.student_information import (  # noqa: F401
    Guardian,
    Student,
    StudentAcademicHistory,
    StudentDocument,
    StudentGuardian,
)
