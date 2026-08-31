"""The permission registry — doc 04. Seeded into the DB by the seed
script (roles/permissions are DB rows, not hardcoded checks), but defined
here as the single source of truth for what gets seeded.

Code pattern: `module:action`.
"""

PERMISSIONS: dict[str, str] = {
    # Identity & platform
    "users:manage": "Create/edit users and assign roles",
    "roles:manage": "Manage role→permission mappings",
    "system_settings:manage": "Edit system_settings",
    "system_settings:view": "View system_settings",
    "academics_core:manage": "Manage academic years, terms, classes, sections, subjects",
    "academics_core:view": "View academic years, terms, classes, sections, subjects",
    # Student Information (doc 07)
    "students:create": "Register a new student",
    "students:update": "Edit a student's core record",
    "students:view": "View any student's full profile",
    "students:view_own": "View own (or own child's) student record",
    "students:view_class": "View the roster for own assigned class",
    "students:allocate_class": "Allocate/transfer a student's class-section",
    "guardians:manage": "Manage guardian records and links",
    "student_documents:manage": "Upload/verify student documents",
    # Fee & Financial Management (doc 08)
    "fees:manage_structure": "Manage fee categories/structures",
    "fees:generate_invoices": "Generate invoices from a fee structure",
    "fees:record_payment": "Record a fee payment",
    "fees:void_payment": "Void/refund a payment",
    "fees:manage_credit": "Apply or refund carried-forward credit",
    "fees:report": "View financial reports",
    "fees:view_own": "View own/own-child fee balance and pay",
    # Attendance (doc 09)
    "attendance:mark": "Mark attendance for own class",
    "attendance:edit": "Edit attendance within the edit window",
    "attendance:edit_locked": "Override a locked attendance session (audited)",
    "attendance:report": "View attendance reports",
    "attendance:view_own": "View own/own-child attendance",
    # Communication & Notifications (doc 10)
    "announcements:publish": "Publish a school-wide announcement",
    "announcements:publish_scoped": "Publish an announcement to own class",
    "events:manage": "Create/edit events",
    "notifications:send": "Send targeted communication",
    "notifications:configure": "Configure notification templates/channels",
    "notifications:view_own": "View own notifications",
    # Academic Performance (doc 11)
    "assessments:manage_own": "Create/edit assessments for own class",
    "scores:enter_own": "Enter/edit scores for own assessments",
    "scores:view_class": "View all subjects' scores for own class",
    "grading_scales:manage": "Manage grading scales",
    "performance:report": "View performance reports",
    "scores:view_own": "View own/own-child scores",
    # Examinations (doc 12)
    "exams:manage": "Create/schedule exams",
    "exam_marks:enter_own": "Enter exam marks for own class",
    "exams:publish": "Publish exam results",
    "report_cards:compile": "Compile a report card for own class",
    "report_cards:publish": "Publish/sign off report cards",
    "exam_results:view_own": "View own/own-child exam results (published only)",
    # Staff Management (doc 13)
    "staff:manage": "Create/edit staff records",
    "staff_assignments:manage": "Assign a teacher to a class",
    "staff_attendance:mark": "Mark staff attendance",
    "staff:view_own": "View own staff record/assignment",
    "staff:report": "View staff reports",
}

# Role -> permission codes. Matches doc 04's permission matrix. A blank
# entry (no codes) still exists as a seeded role; it just starts with no
# permissions until explicitly granted.
ROLE_PERMISSIONS: dict[str, list[str]] = {
    "admin": list(PERMISSIONS.keys()),  # full operational control (doc 04)
    "principal": [
        "students:view",
        "fees:report",
        "attendance:report",
        "announcements:publish",
        "events:manage",
        "performance:report",
        "grading_scales:manage",
        "exams:publish",
        "report_cards:publish",
        "staff:report",
        "academics_core:view",
        "system_settings:view",
    ],
    "registrar": [
        "students:create",
        "students:update",
        "students:view",
        "students:allocate_class",
        "guardians:manage",
        "student_documents:manage",
        "attendance:report",
        "notifications:send",
        "academics_core:view",
    ],
    "accountant": [
        "fees:manage_structure",
        "fees:generate_invoices",
        "fees:record_payment",
        "fees:void_payment",
        "fees:manage_credit",
        "fees:report",
        "notifications:send",
        "academics_core:view",
    ],
    "teacher": [
        "students:view_class",
        "attendance:mark",
        "attendance:edit",
        "attendance:view_own",
        "announcements:publish_scoped",
        "events:manage",
        "assessments:manage_own",
        "scores:enter_own",
        "scores:view_class",
        "exam_marks:enter_own",
        "report_cards:compile",
        "staff:view_own",
        "academics_core:view",
    ],
    "student": [
        "students:view_own",
        "fees:view_own",
        "attendance:view_own",
        "notifications:view_own",
        "scores:view_own",
        "exam_results:view_own",
    ],
    "parent": [
        "students:view_own",
        "fees:view_own",
        "attendance:view_own",
        "notifications:view_own",
        "scores:view_own",
        "exam_results:view_own",
    ],
}

ROLE_DEFINITIONS: dict[str, str] = {
    "admin": "Full operational control of the school instance",
    "principal": "Read-heavy oversight + approvals across all modules",
    "registrar": "Student registration, guardians, documents, class allocation",
    "accountant": "Fee structures, payments, receipts, credits, financial reports",
    "teacher": "Owns exactly one class, all subjects (doc 01/13)",
    "student": "Read-only self-service",
    "parent": "Read-only self-service for linked children",
}
