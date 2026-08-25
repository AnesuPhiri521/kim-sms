# 13 — Module: Teacher & Staff Management

> **Objective:** Centralize staff records, teacher assignments, subjects,
> classes, responsibilities, attendance, and other administrative
> information.

## Key entities

`staff`, `staff_assignments`, `staff_attendance`, `staff_documents`
(doc 05, section 4), plus shared `subjects`/`sections`/`academic_years`/
`terms`.

## Roles & permissions

| Action | Role(s) |
|---|---|
| Create/edit staff record | Admin |
| Assign a teacher to a class | Admin, Principal |
| Mark staff attendance | Admin, Registrar (front-office check-in) |
| View own record/assignment | Teacher (self) |
| View all staff records/reports | Admin, Principal |

Codes: `staff:manage`, `staff_assignments:manage`, `staff_attendance:mark`,
`staff:view_own`, `staff:report`.

## Core features / user stories

1. **Staff onboarding**: Admin creates a staff record (personal info,
   employment details, department, designation, qualifications) and an
   associated user account with the appropriate role(s) — reuses the
   invite-link account creation flow from doc 04.
2. **Assignment management**: assign a teacher to **exactly one class**
   (section) for the current academic year/term. This is the school's
   staffing model — one teacher, one class, every subject (doc 01) —
   so there is no per-subject assignment step and no separate
   "class teacher" flag to set: being assigned the class already means
   teaching all of it. This single assignment is what drives every
   Teacher-scoping rule across docs 09/11/12.
3. **Assignment integrity checks**: the service layer enforces both
   directions of the 1-teacher-1-class rule — a class can't be given a
   second teacher while it already has one this term, and a teacher
   can't be given a second class while they already have one this term.
   Reassigning either requires explicitly clearing the existing
   assignment first (an intentional, auditable action, not an accidental
   overwrite).
4. **Staff attendance**: daily check-in/check-out or simple present/
   absent/leave marking, mirroring the pattern in doc 09 but for staff;
   feeds a staff attendance report (relevant for HR/payroll handoff,
   even though payroll itself is out of scope).
5. **Document management**: contracts, certifications, ID documents —
   same pattern as doc 07's student documents.
6. **Staff directory**: searchable list with department/designation
   filters, contact info, current assignments at a glance.
7. **Employment status transitions**: `active` → `on_leave` →
   `terminated`, deactivating system access on termination while
   retaining historical records (who taught what, when — needed for
   report card/exam history integrity, so staff records are never hard
   deleted).

## API surface (high level)

```
GET/POST         /api/v1/staff                                filter: department, designation, employment_status, search
GET               /api/v1/staff/{id}
PATCH             /api/v1/staff/{id}
POST              /api/v1/staff/{id}/deactivate

GET/POST          /api/v1/staff-assignments?staff_id=&section_id=&term_id=    one row = one teacher's one class for one term
DELETE            /api/v1/staff-assignments/{id}                              clears the assignment (required before reassigning either side)

POST              /api/v1/staff-attendance:bulk
GET               /api/v1/staff/{id}/attendance

GET/POST          /api/v1/staff/{id}/documents

GET               /api/v1/reports/staff-directory
GET               /api/v1/reports/unassigned                                  classes with no teacher, and teachers with no class
```

## UI screens

- **Staff directory** (shadcn `DataTable`): filter by department/
  designation/status.
- **Staff profile**: tabs for Overview / Assignment / Attendance /
  Documents.
- **Assignment list**: one row per class (section), each with a single
  teacher-select dropdown — not a matrix, since there's only one
  dimension to assign (class → teacher, not class × subject → teacher).
  Unassigned classes and unassigned teachers are both surfaced clearly
  so nothing is missed before the term starts.
- **Staff attendance register**: similar UI pattern to doc 09's
  attendance grid, scoped to staff.
- **Self-service view** (Teacher): "my class" and "my profile" read-only
  (edit requests go to Admin).

## Business rules & edge cases

- Exactly one teacher per class per term, and exactly one class per
  teacher per term — both directions enforced at the service layer
  (doc 13 feature 3). This is the one load-bearing rule the whole
  staffing model rests on.
- Removing a staff assignment mid-term doesn't retroactively alter past
  attendance/grade records they entered — those keep the original
  `staff_id` reference for historical integrity.
- Deactivating a staff account revokes login/API access immediately
  (refresh-token revocation, doc 02) even though the record itself is
  retained. Its class assignment must be explicitly reassigned to
  someone else — a class is never silently left teacher-less.
- Staff without a class assignment (Admin, Principal, Registrar,
  Accountant, or a teacher between assignments) are valid and expected —
  the 1:1 rule applies to *teachers with a class*, not to every staff
  record.

## Reports

- Staff directory export.
- Unassigned classes / unassigned teachers list (an operational
  checklist for the start of a term, not a workload-balancing report —
  there's no variable load to balance when every teacher has exactly
  one class).
- Staff attendance summary per term.

## Dependencies

- **Depends on**: Identity & Access (roles/users), shared academic
  calendar (doc 05).
- **Depended on by**: Attendance (09), Academic Performance (11),
  Examinations (12) — all use `staff_assignments` to resolve which
  single Teacher owns a given class.
