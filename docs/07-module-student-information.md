# 07 — Module: Student Information Management

> **Objective:** Create a secure and centralized student information system
> for managing student registration, personal information, guardians,
> academic history, class allocation, documents, attendance, and fees.

This is the **foundation module** — nearly every other module references
`students`, `sections`, and `student_guardians` defined here. Build this
first (see doc 16).

## Key entities

`students`, `guardians`, `student_guardians`, `student_documents`,
`student_academic_history`, plus the shared `classes`/`sections`/
`academic_years`/`terms` (doc 05, sections 2–3).

## Roles & permissions

| Action | Role(s) |
|---|---|
| Register new student, edit core record | Registrar, Admin |
| Manage guardians / link to student | Registrar, Admin |
| Upload/verify documents | Registrar, Admin |
| Allocate/transfer class-section | Registrar, Admin |
| View full student profile | Registrar, Admin, Principal |
| View own class students (roster only) | Teacher |
| View own record | Student |
| View own child's record | Parent |

Full codes: `students:create`, `students:update`, `students:view`,
`students:view_own`, `students:allocate_class`, `guardians:manage`,
`student_documents:manage`. Data-scoping per doc 04.

## Core features / user stories

1. **Enrollment/registration wizard**: capture personal info → link/create
   guardian(s) → assign class/section → upload required documents →
   generate `admission_no`. Produces an `active` student record.
2. **Guardian management**: a guardian can be linked to multiple students
   (siblings); mark primary contact and billing contact independently
   (the person who picks up a child isn't always the one who pays fees).
3. **Class allocation & transfers**: move a student between sections
   (mid-year section change) or promote/transfer between classes at
   year-end, writing a row to `student_academic_history` each time so the
   student's placement history is never lost.
4. **Document management**: upload required documents (birth certificate,
   prior transcripts, immunization record, ID photo) with a verification
   flag so Registrar can track outstanding paperwork.
5. **360° student profile view**: a single screen aggregating identity,
   guardians, current class, attendance rate (from doc 09), fee balance
   plus the Term 1 / Term 2 / Term 3 fee tracking breakdown (from doc 08),
   and recent grades (from doc 11) — read-only rollups pulled from the
   other modules, not duplicated data.
6. **Withdrawal / graduation**: status transition (`withdrawn`,
   `transferred_out`, `graduated`) that deactivates portal access but
   **retains** all historical records (fees, grades, attendance) for
   compliance and reference — never a hard delete.
7. **Self-service portal access**: Registrar can generate a parent/student
   portal invite once contact info is on file.

## API surface (high level)

```
POST   /api/v1/students                       create (registration)
GET    /api/v1/students                       list (paginated, filter by section/status)
GET    /api/v1/students/{id}                  full profile
PATCH  /api/v1/students/{id}                  update core info
POST   /api/v1/students/{id}/allocate-section  class/section allocation
POST   /api/v1/students/{id}/withdraw          status transition
GET    /api/v1/students/{id}/history           academic history timeline

GET    /api/v1/guardians
POST   /api/v1/guardians
PATCH  /api/v1/guardians/{id}
POST   /api/v1/students/{id}/guardians         link guardian to student

POST   /api/v1/students/{id}/documents         upload
GET    /api/v1/students/{id}/documents
PATCH  /api/v1/students/{id}/documents/{doc_id}  verify

GET    /api/v1/sections/{id}/students          class roster
```

## UI screens

- **Student list** (shadcn `DataTable`): filter by section/status/search
  by name-admission no, server-paginated.
- **Registration wizard** (shadcn `Form` + `Tabs` or multi-step `Stepper`
  pattern built from `Card`/`Progress`): personal info → guardians →
  class → documents.
- **Student profile** (shadcn `Tabs`: Overview / Guardians / Documents /
  Attendance / Fees / Academics) — the aggregation view.
- **Guardian directory** with linked-students column.
- Role-scoped: Teacher sees a read-only roster (`Sheet`/`Table`) for
  their one assigned class; Parent/Student see a simplified read-only
  profile.

## Business rules & edge cases

- `admission_no` is unique per school and immutable once assigned.
- A student cannot be allocated to a section that has reached `capacity`
  without an explicit override (logged).
- Deleting a guardian link requires at least one remaining guardian on the
  student record (a student can't be left with zero guardians).
- Withdrawing a student with an outstanding fee balance surfaces a
  warning (doesn't block, but requires acknowledgment) so Registrar
  coordinates with Accountant.
- Sibling discovery: when creating a guardian whose phone/email matches an
  existing guardian, the UI prompts "link as existing guardian?" instead
  of silently creating a duplicate.

## Reports

- Enrollment by class/section, gender breakdown, new admissions this term,
  withdrawals/transfers this term, document-completeness report.

## Dependencies

- **Depended on by**: Fees (08), Attendance (09), Communication (10),
  Academic Performance (11), Examinations (12) — all key off `students`
  and `sections`.
- **Depends on**: Identity & Access (roles/users) and the shared academic
  calendar (`academic_years`, `terms`, `classes`, `sections`) from doc 05.
