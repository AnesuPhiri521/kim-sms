# 04 — Roles & Permissions

## Model

RBAC with **roles** (assigned to users) mapping to **permissions**
(fine-grained `module:action` codes), plus **data-scoping rules** applied
in the service layer on top of raw permission checks. A user can hold more
than one role (e.g. a teacher who is also a parent of a student at the same
school) — the effective permission set is the union of all assigned roles'
permissions, and data-scoping is evaluated per role context.

```
users ──< user_roles >── roles ──< role_permissions >── permissions
```

- `permissions.code` uses the pattern `module:action`, e.g. `fees:create`,
  `fees:approve_discount`, `attendance:mark`, `students:view`,
  `grades:publish`.
- `roles` are seeded (not freely user-created in v1) but the mapping
  `role_permissions` is stored in the DB, not hardcoded, so an Admin can
  adjust a role's permissions without a code deploy.
- The JWT access token carries `user_id` and `role codes`, and is
  the only thing routers trust for identity; permissions themselves are
  re-checked server-side per request against the DB-backed dependency (not
  baked into the token), so revoking a permission takes effect immediately
  without waiting for token expiry.

## Roles

| Role | Description |
|---|---|
| **Admin** | Full operational control of the school instance: users, roles, all modules, all reports. |
| **Principal / Head Teacher** | Read-heavy oversight across all modules + approvals (discounts above threshold, report card sign-off, staff records) without day-to-day data entry access. |
| **Registrar / Front Office** | Student registration, guardian records, documents, class allocation. |
| **Accountant / Finance Officer** | Fee structures, payments, receipts, discounts, financial reports. No access to grades/exams. |
| **Teacher** | Owns exactly one class (doc 01/13: one teacher, one class, all subjects) — attendance marking, grade/assessment entry, and exam-mark entry across every subject taught in that class, plus report card compilation/sign-off and parent communication for it. There is no separate "subject teacher" vs "class teacher" split — every teacher already has full ownership of their one class. |
| **Student** | Read-only self-service: own timetable, attendance, grades, fee balance, announcements. |
| **Parent/Guardian** | Read-only self-service for their linked child(ren): attendance, grades, fee balance/payment, receives notifications; can initiate fee payments. |

This is a single-school system — **Admin is the top role**; there is no
separate platform-level "Super Admin" or schools-admin layer.

## Permission matrix (high level — see each module doc for the full endpoint-level list)

Legend: **C**reate · **R**ead · **U**pdate · **D**elete/void · **A**pprove/publish · **X**export/report

| Module | Admin | Principal | Registrar | Accountant | Teacher | Student | Parent |
|---|---|---|---|---|---|---|---|
| Student Information | CRUD, X | R, X | CRUD | R | R (own class) | R (self) | R (own child) |
| Fee & Financial | CRUD, A, X | R, A (above threshold), X | — | CRUD, X | — | R (self) | R + pay (own child) |
| Attendance | CRUD, X | R, X | R | — | CRU (own class, all subjects), X (own class) | R (self) | R (own child) |
| Communication | CRUD, X | CR, X | CR (student-related) | CR (fee-related) | CR (own class) | R | R |
| Academic Performance | CRUD, A, X | R, A, X | — | — | CRU (own class, all subjects), compile | R (self) | R (own child) |
| Examinations | CRUD, A, X | R, A, X | — | — | CU marks (own class, all subjects) | R (self, published only) | R (own child, published only) |
| Staff Management | CRUD, X | R, X | — | — | R (self) | — | — |
| Roles & Users | CRUD | R | — | — | — | — | — |
| System Settings | CRUD | R | — | — | — | — | — |

Notes:
- **Parents never see unpublished grades/exam results** — only after the
  Principal/Admin marks a result set as `published` (doc 12).
- **Accountant has no visibility into grades/exams**, and **Teachers have no
  visibility into fee data** beyond, at most, a read-only "fee status
  flag" if the school explicitly wants teachers to know a student's account
  is delinquent (configurable, off by default — see doc 08 privacy note).
- **Discount approval above a configurable threshold** requires
  Principal/Admin approval even though the Accountant can create the
  discount request — a maker/checker control (doc 14).

## Data-scoping rules (enforced in the service layer, not just the route)

| Role | Scope rule |
|---|---|
| Teacher | Can only read/write attendance, grades, and exam marks for the **one class** they are assigned to in `staff_assignments` (doc 13) for the **current** academic year/term — across *every* subject taught in that class, since one teacher owns the whole class. No per-subject restriction: there's nothing to restrict, as there is no other teacher for that class's other subjects. |
| Parent | Can only read records for students linked to them via `student_guardians`, and only for the child(ren) actively enrolled. |
| Student | Can only read their own record. |
| Accountant | School-wide on financial tables only; no cross-module reach. |
| Registrar | School-wide on student/guardian tables; cannot touch fees, grades, or attendance analytics. |

## Auth & account lifecycle

- **Account creation**: staff accounts are created by Admin/Registrar
  (never self-registered); parent/student accounts are created by
  Registrar during student enrollment or invited via a signed email link.
- **Temporary password / invite flow**: new accounts get a one-time signed
  link to set their own password (not an emailed plaintext password).
- **Password policy**: minimum length + complexity checked server-side
  (never trust client-side-only validation); breached-password check
  optional/deferred.
- **Account lockout**: N consecutive failed logins → temporary lockout +
  notification to the account owner, to blunt brute-force attempts.
- **Session/refresh-token revocation**: Admin can force-revoke a user's
  active sessions (e.g. staff offboarding) — a real operational
  requirement handled via the `refresh_tokens` table from doc 02.
- **Role change auditing**: every change to a user's roles is written to
  `audit_logs` with who made the change and when.

## System Settings (Admin-only)

A dedicated screen over the `system_settings` table (doc 05 §1) —
the concrete home for every business-rule "default" mentioned across
this plan (fee discount threshold, attendance edit-lock window,
absenteeism/at-risk triggers, class-ranking toggle, currency code,
password policy, backup retention). Grouped by category in the UI
(Finance / Attendance / Academics / Security / Ops) so it reads as a
settings panel per module rather than one long flat list. Every change
is written to `audit_logs` (who changed which setting, old → new value)
— these are business-rule changes, not cosmetic preferences, and get
the same accountability as a role or discount change. Permission code:
`system_settings:manage` (Admin only; Principal gets read access via
`system_settings:view` since several settings — ranking, at-risk
threshold — are academic policy they should be able to see even if
only Admin changes them).
