# 09 — Module: Attendance Management

> **Objective:** Provide an efficient attendance management system that
> enables schools to record, monitor, analyse, and report student
> attendance while identifying absenteeism and improving student
> accountability.

## Key entities

`attendance_sessions`, `attendance_records`, `attendance_daily_summary`,
`absenteeism_flags` (doc 05, section 6).

## Roles & permissions

| Action | Role(s) |
|---|---|
| Mark attendance for own class (all subjects/periods) | Teacher |
| Edit attendance within the edit window | Teacher (own class) |
| Edit attendance after lock (override) | Admin only, audited |
| View section/school-wide attendance reports | Teacher (own class), Principal, Admin, Registrar |
| View own attendance | Student |
| View own child's attendance | Parent |

Codes: `attendance:mark`, `attendance:edit`, `attendance:edit_locked`,
`attendance:report`, `attendance:view_own`.

## Core features / user stories

1. **Session-based marking**: the Teacher opens their class's scheduled
   period, sees the roster, marks each student
   present/absent/late/excused/half-day in one bulk action (default all
   "present", toggle exceptions — fast for the common case). Since one
   teacher owns every subject/period for their class, the same person
   marks all of them — there's no handoff between a subject teacher and
   a separate homeroom teacher.
2. **Daily whole-day attendance**: alongside (or instead of) per-period
   marking, the Teacher can mark a single whole-day status for the
   class, for schools that don't need period-by-period granularity —
   still the same teacher either way, just a coarser or finer marking
   mode.
3. **Edit window & locking**: attendance for a session can be edited
   freely for `system_settings.attendance_edit_lock_hours` (default
   `24`, doc 05 §1); after that it locks and any change requires an
   Admin override that's fully audited — prevents quiet retroactive
   rewriting of attendance history.
4. **Absenteeism detection**: a background job (doc 02) scans daily
   summaries per term and flags students crossing
   `system_settings.absenteeism_consecutive_absences_trigger` (default
   `3`) or `absenteeism_rate_trigger_pct`, writing to
   `absenteeism_flags` and triggering a notification (doc 10) to the
   class's Teacher and to the student's Parent.
5. **Attendance analytics**: attendance rate trends by student, section,
   class, and school-wide; identify chronic absenteeism and patterns
   (e.g. consistently absent on a particular weekday).
6. **Leave/excuse requests**: Parent can submit an excuse/leave note for
   an absence (with optional document attachment, e.g. a medical note);
   the class's Teacher approves, which updates the record's status to
   `excused`.

## API surface (high level)

```
POST   /api/v1/attendance-sessions                      create a session (or auto-created from timetable)
GET    /api/v1/attendance-sessions?section_id=&date=
POST   /api/v1/attendance-sessions/{id}/records:bulk     mark/update a whole class at once
PATCH  /api/v1/attendance-records/{id}                   single-record edit (subject to lock rules)
POST   /api/v1/attendance-sessions/{id}/lock-override     admin override, audited

GET    /api/v1/students/{id}/attendance                  student history
GET    /api/v1/students/{id}/attendance/summary           rate, streaks

GET    /api/v1/reports/attendance/section/{id}
GET    /api/v1/reports/attendance/absenteeism             flagged students

POST   /api/v1/attendance-records/{id}/excuse-requests
POST   /api/v1/excuse-requests/{id}/approve
```

## UI screens

- **Take attendance** (Teacher): roster list with quick toggle chips
  (shadcn `ToggleGroup`/`Badge`), "mark all present" default, save as
  bulk action, visual lock-state indicator.
- **Attendance calendar** (Student/Parent view): month grid, color-coded
  by status, click a day for detail.
- **Section attendance report** (Teacher/Principal/Admin): table +
  trend chart, exportable.
- **Absenteeism watchlist**: flagged-students table with drill-down to
  the student's attendance history, one-click "notify parent" action
  (already automated by the background job, but manual trigger available).
- **Excuse request inbox** (Teacher): pending requests with
  approve/reject.

## Business rules & edge cases

- Attendance cannot be marked for a future date.
- A student who is `withdrawn`/`transferred_out` is excluded from active
  rosters going forward but their historical records remain untouched.
- Bulk marking is transactional per session — a partial failure doesn't
  leave a session half-marked.
- Absenteeism thresholds live in `system_settings` (doc 05 §1), not
  hardcoded, and are editable by Admin via the System Settings screen
  (doc 04).
- Locked-session edits always create an `audit_logs` entry capturing
  before/after values and the overriding Admin.

## Reports

- Daily/weekly/term attendance rate by student/section/class.
- Absenteeism watchlist (consecutive absences, rate below threshold).
- Attendance vs academic-performance correlation (feeds doc 11 insights,
  v2 candidate).

## Dependencies

- **Depends on**: Student Information (07) for rosters/sections; Staff
  Management (13) for which teacher can mark which session.
- **Feeds**: Communication (10) for absenteeism alerts; Student profile
  rollup (07); report cards' attendance summary (doc 12).
