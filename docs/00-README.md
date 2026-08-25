# EduManage — Planning Documentation

EduManage is a school management platform covering fee & financial management,
attendance, communication, student information, academic performance,
examinations, and staff management. This `docs/` folder is the single source
of truth for the system design before any code is written.

**Stack:** FastAPI (Python) backend · Next.js + shadcn/ui (strict) frontend ·
SQLite database · JWT-based RBAC.

## Reading order

| # | Document | Purpose |
|---|----------|---------|
| 01 | [Project Overview](./01-project-overview.md) | Vision, objectives, personas, scope |
| 02 | [System Architecture](./02-system-architecture.md) | Component layout, request/auth flow, repo structure |
| 03 | [Tech Stack & Conventions](./03-tech-stack-and-conventions.md) | Libraries, coding standards, testing, CI/CD |
| 04 | [Roles & Permissions](./04-roles-and-permissions.md) | RBAC model, permission matrix, data-scoping rules |
| 05 | [Database Schema](./05-database-schema.md) | Entity domains, tables, relationships, indexing |
| 06 | [API Design Guidelines](./06-api-design-guidelines.md) | REST conventions, envelopes, errors, pagination |
| 07 | [Module: Student Information](./07-module-student-information.md) | Core student/guardian records (foundation module) |
| 08 | [Module: Fee & Financial Management](./08-module-fee-financial-management.md) | Fee structures, payments, receipts, discounts |
| 09 | [Module: Attendance Management](./09-module-attendance-management.md) | Marking, analytics, absenteeism alerts |
| 10 | [Module: Communication & Notifications](./10-module-communication-notifications.md) | In-app/email notifications, announcements |
| 11 | [Module: Academic Performance](./11-module-academic-performance.md) | Grades, assessments, progress tracking |
| 12 | [Module: Examination Management](./12-module-examination-management.md) | Exams, grading structures, report cards |
| 13 | [Module: Staff Management](./13-module-staff-management.md) | Staff records, assignments, staff attendance |
| 14 | [Security Best Practices](./14-security-best-practices.md) | AuthN/AuthZ, data protection, hardening checklist |
| 15 | [Non-Functional Requirements](./15-non-functional-requirements.md) | Performance, scalability, availability, observability |
| 16 | [Implementation Roadmap](./16-implementation-roadmap.md) | Phased delivery plan and rationale for ordering |
| 17 | [UI/UX Guidelines](./17-ui-ux-guidelines.md) | Concrete "nice and clean" spec: spacing/type scale, required states, forms, responsive/a11y baseline |
| 18 | [Pre-Implementation Checklist](./18-pre-implementation-checklist.md) | School config to gather, defaults to confirm, accepted risks, cross-module edge-case index, go/no-go list |
| — | [tasks.md](./tasks.md) | Actionable, checkable task list driving implementation |

## How this maps to the 7 stated objectives

1. Fee & Financial Management → doc 08
2. Attendance Management → doc 09
3. Communication & Notifications → doc 10
4. Student Information Management → doc 07 (treated as the **foundation module**, since fees, attendance, academics, and communication all key off student/guardian/class records)
5. Academic Performance Management → doc 11
6. Academic & Examination Management → doc 12
7. Staff Management → doc 13

## Working agreement

- This is a **planning-only** phase — no application code is written yet.
  `backend/` and `frontend/` exist at the project root as empty folders,
  matching doc 02's structure, ready for Phase 0's first commits.
- Every module doc follows the same template (objective, entities, roles,
  features, API surface, UI screens, business rules, dependencies) so
  coverage stays consistent and nothing is forgotten.
- `tasks.md` is the living checklist. As implementation begins, tasks are
  checked off there; architectural decisions that change should be reflected
  back into the numbered docs, not just in commit messages.
- Before writing the first line of code, run through doc 18's go/no-go
  checklist — it exists specifically to catch gaps and unconfirmed
  assumptions while they're still cheap to fix.
