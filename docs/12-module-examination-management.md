# 12 — Module: Academic & Examination Management

> **Objective:** Simplify the management of subjects, classes,
> examinations, assessments, grading structures, report cards, and
> academic results.

Subjects/classes/grading-structures are shared foundation (doc 05,
sections 2 & 8) used by both this module and doc 11. This module's
distinct scope is the **formal exam lifecycle** (schedule → sit → mark →
publish) and **report card compilation**.

## Key entities

`exams`, `exam_schedules`, `exam_results`, `report_cards`,
`report_card_comments`, plus shared `grading_scales`.

## Roles & permissions

| Action | Role(s) |
|---|---|
| Create/schedule an exam | Admin, Principal |
| Enter marks, any subject, for own class | Teacher |
| **Publish** exam results | Principal, Admin |
| Compile report card for own class | Teacher |
| **Publish/sign off** report cards | Principal, Admin |
| View own results (post-publish only) | Student |
| View own child's results (post-publish only) | Parent |

Codes: `exams:manage`, `exam_marks:enter_own`, `exams:publish`,
`report_cards:compile`, `report_cards:publish`, `exam_results:view_own`.

## Core features / user stories

1. **Exam setup**: Admin/Principal defines an exam (e.g. "Mid-Term",
   "Final") for a term, then schedules it per section/subject
   (`exam_schedules`: date, time, room, max score) — effectively the
   exam timetable.
2. **Mark entry**: the class's Teacher enters marks per `exam_schedule`
   for every subject taught in their class via the same bulk-grid
   pattern as doc 11, with an absent flag — the same teacher enters all
   of it, since there's no separate subject-specialist teacher.
3. **Grading & ranking**: raw marks map to grades via `grading_scales`
   (letters or descriptive bands, doc 01 "Regional context"); optional
   class rank computed per subject and overall, gated by
   `system_settings.class_ranking_enabled` (default `false`, doc 05 §1
   — some schools don't rank).
4. **Publish gate**: exam results are **not visible to students/parents**
   until explicitly published by Principal/Admin — a deliberate control
   point so results can be reviewed/corrected before release, and so the
   whole class's results release together rather than trickling out.
5. **Report card compilation**: the class's Teacher compiles a report
   card per student per term, pulling in: exam results across subjects,
   (per school policy) coursework averages from doc 11, attendance
   summary snapshot from doc 09, and adds an overall comment; per-subject
   comments can be pulled from doc 11's teacher comments or entered
   fresh — all authored by the same teacher, since they own every
   subject.
6. **Report card review & publish**: draft → Principal/Admin review →
   publish (generates a PDF, notifies parents via doc 10). Mirrors the
   exam-results publish gate for the same reason.
7. **Historical results access**: students/parents can view all
   *published* past terms' results and report cards, not just the
   current one.

## API surface (high level)

```
GET/POST/PATCH  /api/v1/exams
GET/POST/PATCH  /api/v1/exams/{id}/schedules
POST            /api/v1/exam-schedules/{id}/results:bulk    mark entry
POST            /api/v1/exams/{id}/publish

GET/POST        /api/v1/report-cards?term_id=&section_id=    list/generate drafts
GET             /api/v1/report-cards/{id}
PATCH           /api/v1/report-cards/{id}                    compile/edit (comments, etc.)
POST            /api/v1/report-cards/{id}/publish
GET             /api/v1/report-cards/{id}.pdf

GET             /api/v1/students/{id}/exam-results            published only, unless staff
GET             /api/v1/students/{id}/report-cards
```

## UI screens

- **Exam scheduler**: calendar/table view building the exam timetable
  per section/subject (shadcn `Calendar` + `Table`).
- **Mark entry grid**: same pattern as doc 11's gradebook, scoped to one
  exam schedule.
- **Publish control** (Principal/Admin): review summary (score
  distribution, any missing marks flagged) before a single "Publish"
  action releases results school/section-wide.
- **Report card compiler** (Teacher): per-student view aggregating all
  subjects' results + attendance + comment fields, with a class-wide
  "all students compiled?" progress indicator.
- **Report card review queue** (Principal/Admin): approve/publish per
  student or in bulk per section.
- **Student/Parent report card view**: read-only formatted view +
  PDF download, list of past terms.

## Business rules & edge cases

- Marks cannot be entered for a schedule after the exam's `status` moves
  to `published` without an audited Admin override (same lock pattern as
  attendance/coursework).
- Publishing is **all-or-nothing per scope** (e.g. a whole section) to
  avoid the fairness problem of some students seeing results before
  others.
- Report card compilation blocks on missing exam marks for a required
  subject (surfaced as a checklist, not a silent gap in the PDF).
- Class rank, if enabled, is computed only among currently `active`
  students in the section (withdrawn students excluded, but their own
  historical rank at the time is preserved on their own past report
  cards).

## Reports

- Score distribution per exam/subject (histogram).
- Pass/fail rate per subject/class.
- Report card completion status per section (for Principal to track
  before a publish deadline).

## Dependencies

- **Depends on**: Student Information (07) for rosters; Staff Management
  (13) for which teacher owns which class; Academic Performance (11)
  for shared `grading_scales` and optionally coursework averages.
- **Feeds**: Communication (10) for publish notifications; Student
  profile rollup (07).
