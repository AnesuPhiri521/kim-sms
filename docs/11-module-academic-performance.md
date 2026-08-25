# 11 — Module: Teacher & Student Academic Performance Management

> **Objective:** Provide teachers with tools for recording grades,
> assessments, examinations, comments, and academic progress while
> enabling schools and parents to monitor student performance and
> identify areas requiring academic support.

This module covers **ongoing coursework assessment** (quizzes,
assignments, projects, continuous assessment). Formal term/final
**examinations** and **report cards** are doc 12 — the two are closely
related and share `grading_scales`, but examinations have their own
scheduling/publication workflow.

## Key entities

`assessment_types`, `assessments`, `student_scores`, `grading_scales`
(shared with doc 12) (doc 05, section 8).

## Roles & permissions

| Action | Role(s) |
|---|---|
| Create an assessment, any subject, for own class | Teacher |
| Enter/edit scores for own assessment | Teacher |
| View all subjects' scores for own class | Teacher |
| View/approve grading scales | Admin, Principal |
| View school-wide performance reports | Principal, Admin |
| View own scores | Student |
| View own child's scores | Parent |

Codes: `assessments:manage_own`, `scores:enter_own`, `scores:view_class`,
`grading_scales:manage`, `performance:report`, `scores:view_own`.

## Core features / user stories

1. **Assessment creation**: the class's Teacher defines an assessment
   (quiz, assignment, project) for any subject taught in their class,
   for a given term, with a max score and weight — weights within a
   term should sum to a sensible total (validated, not silently allowed
   to be inconsistent). Since the same teacher owns every subject for
   their class, there's no per-subject teacher to coordinate with.
2. **Score entry**: bulk grid entry (all students in a section for one
   assessment, spreadsheet-like) with per-student comments and an
   "absent" flag (excluded from average rather than counted as zero,
   configurable).
3. **Automatic grade computation**: raw scores map to letter
   grades/GPA via the school's configured `grading_scales`; a weighted
   term average per subject is computed from all assessments in that
   term.
4. **Progress tracking / at-risk detection**: a background job flags
   students whose weighted average drops below
   `system_settings.academic_at_risk_threshold_pct` (doc 05 §1) or drops
   sharply term-over-term, surfaced to the class's Teacher and
   Principal (and optionally notifies Parent — doc 10) — directly serves
   "identify areas requiring academic support."
5. **Teacher comments**: free-text comments per assessment and a
   consolidated per-subject term comment, used later in report cards
   (doc 12).
6. **Performance dashboards**:
   - Student: subject-by-subject trend over the term/year.
   - Teacher: whole-class performance heatmap across all subjects they
     teach for their class.
   - Principal/Admin: school/class/subject-level aggregate trends,
     year-over-year comparison.
7. **Parent visibility**: parents see scores as they're entered (not
   gated behind a "publish" step, unlike final exam results in doc 12) —
   ongoing coursework is meant to be visible in near-real-time so
   parents can act early; this is a deliberate difference from doc 12's
   publish-gated exam results.

## API surface (high level)

```
GET/POST/PATCH  /api/v1/assessments                    filter by section/subject/term
POST            /api/v1/assessments/{id}/scores:bulk    bulk score entry
PATCH           /api/v1/scores/{id}

GET             /api/v1/students/{id}/performance        subject-by-subject summary
GET             /api/v1/students/{id}/performance/trend

GET/POST/PATCH  /api/v1/grading-scales                   admin-managed

GET             /api/v1/reports/performance/section/{id}
GET             /api/v1/reports/performance/at-risk       flagged students
```

## UI screens

- **Gradebook grid** (Teacher): spreadsheet-like table (shadcn
  `DataTable` with inline-editable cells) — students as rows, one
  assessment's scores as the editable column, comments in a side panel/
  popover.
- **Assessment list** per subject/section with weight-sum indicator.
- **Student performance page** (Student/Parent): subject cards with
  trend sparklines, comments feed.
- **Teacher dashboard**: heatmap/table of all subjects × students for
  their class, at-risk students highlighted.
- **Principal/Admin analytics**: aggregate charts (shadcn chart
  components) by class/subject/term, exportable.

## Business rules & edge cases

- A Teacher can only enter/edit scores for assessments they created, for
  the one class in their current `staff_assignments` — but for *any*
  subject taught in that class, since they own all of them — enforced
  server-side, not just hidden in the UI.
- Editing a score after a term is closed (see doc 12 term-close workflow)
  requires an audited Admin override, same pattern as locked attendance.
- Score entry validates `0 <= score_obtained <= max_score` server-side
  regardless of any client-side constraint.
- At-risk thresholds live in `system_settings` (doc 05 §1), editable by
  Admin via the System Settings screen (doc 04), not hardcoded.

## Reports

- Subject/class/school average trends over time.
- At-risk student watchlist.
- Teacher-level grading activity (are assessments being entered on time?
  — an operational health metric for Admin, not a teacher-evaluation
  tool).

## Dependencies

- **Depends on**: Student Information (07), Staff Management (13) for
  assignment scoping, shared `grading_scales` (doc 05/12).
- **Feeds**: Examinations & report cards (12) may reference term-average
  coursework alongside exam scores depending on the school's grading
  policy; Communication (10) for at-risk alerts; Student profile rollup
  (07).
