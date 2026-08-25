# 18 — Pre-Implementation Readiness Checklist

Purpose: catch gaps, ambiguities, and unconfirmed assumptions **before**
Phase 0 starts, not during it. Four parts: school-specific config to
gather, design decisions made on the school's behalf that should be
confirmed, accepted risks/trade-offs, and a final go/no-go list.

## A. School-specific configuration to gather before/at setup

These aren't system design questions — they're facts about *this* school
that the system needs on day one. Collecting them now avoids a stalled
Phase 1/2 kickoff waiting on answers.

- [ ] Current academic year's start/end date, and each of Term 1/Term 2/
      Term 3's start/end dates (doc 05 §2).
- [x] Classes confirmed: Grades 1–7, each split into one or more
      lettered sections (e.g. "Grade 1 A", "Grade 1 B") — each section
      is a genuinely separate class with its own teacher and roster
      (doc 01/05).
- [ ] **Section roster** — fill in one row per section as it's confirmed
      (capacity and teacher are per-section, so this table *is* the
      Phase 1 seed data for `sections` + `staff_assignments`, not just a
      checklist). One row is already confirmed as a worked example:

      | Section | Capacity | Assigned Teacher | Status |
      |---|---|---|---|
      | Grade 1 A | TBC | Mr Tea | ✅ teacher confirmed |
      | Grade 1 B | TBC | TBC | — |
      | Grade 2 … 7 (A/B/…) | TBC | TBC | — |

      Add a row per section as each grade's section count and teacher
      are confirmed with the school; this table should be complete
      before Phase 1's staff-assignment tasks (`tasks.md`) start, since
      the "one teacher, one class" rule (doc 13) needs every section to
      resolve to exactly one teacher on day one. Also confirm: does
      every grade actually split into multiple sections, or do some
      grades (e.g. smaller cohorts) run as a single unlettered class?
      The schema doesn't assume a section always needs a letter suffix.
- [ ] Full subject list **per grade** (not just one school-wide list) —
      matters more than usual here, since one teacher owns every subject
      for their class (doc 13): a grade's subject list *is* that
      teacher's full curriculum. Confirm whether all 7 grades share the
      same subjects or it varies by grade (e.g. a subject introduced
      only from Grade 4 onward).
- [ ] Fee categories and the actual amount for each, per class, per term
      (doc 08) — this is the single biggest data-entry task before the
      Fee module is usable.
- [ ] Staff roster: names, roles, department/designation — cross-check
      against the section roster above so every teacher's one class
      assignment is accounted for (and any staff without a class, e.g.
      Principal/Registrar/Accountant, is expected to have none).
- [ ] Student roster for initial import (or confirmation that
      registration will happen live through the system from day one —
      affects whether a bulk-import task is needed in Phase 1).
- [ ] Guardian contact details (phone/email) for the notification system
      to actually reach someone on day one.
- [ ] School branding: name, logo, address, contact info, timezone
      (`school_settings`, doc 05 §1).
- [ ] Grading scale definitions: letters, GPA bands, and/or descriptive
      bands (e.g. "Meets Expectation") and their score ranges (doc 05
      §8) — needed before Phase 4 can be tested meaningfully. Confirm
      which style this school's curriculum actually uses.

## B. Design decisions made on the school's behalf — confirm or adjust

Every item below is **not hardcoded** — each one is a real row in the
`system_settings` table (doc 05 §1) or a genuine CRUD list, editable by
Admin any time via the System Settings screen (doc 04) without a code
change. The values below are just the *starting* defaults (several
grounded in Zimbabwean convention, doc 01 "Regional context"), and each
is still a real policy choice worth explicitly confirming with the
school rather than silently trusting the default.

| Decision | `system_settings` key / mechanism | Default | Confirm with school |
|---|---|---|---|
| Term structure | `terms` CRUD (doc 05 §2) | 3-term template (Term 1/2/3) | Does this school's calendar actually run 3 terms, or differently? |
| Currency | `currency_code` | `USD` | Confirm actual fee-collection currency (USD vs ZiG vs other) |
| Discount approval threshold | `fee_discount_approval_threshold_cents` | none set — must be confirmed before Phase 2 discount approval is meaningful | What amount? |
| Attendance edit-lock window | `attendance_edit_lock_hours` | `24` | How long should teachers be able to self-correct? |
| Absenteeism flag trigger | `absenteeism_consecutive_absences_trigger` / `absenteeism_rate_trigger_pct` | `3` consecutive absences | Exact numbers, and is a rate-based trigger also wanted? |
| Academic at-risk trigger | `academic_at_risk_threshold_pct` | none set | Exact threshold? |
| Class ranking | `class_ranking_enabled` | `false` | Does this school rank students? |
| Teacher visibility into fee status | `teacher_fee_status_visibility` | `false` (privacy) | Does the school want teachers to see a simple current/overdue flag? |
| Fee categories | `fee_categories` CRUD (doc 05 §5) | Tuition / Development Levy / PTA-SDC / Sports / ICT / Exam Fee | Does this list match what the school actually charges? |
| Grading scale | `grading_scales` CRUD (doc 05 §8) | none set | Letters, descriptive bands (per curriculum), or both — and the score ranges |
| Assessment types | `assessment_types` CRUD (doc 05 §8) | CALA Task / End of Term Test (+ generic quiz/assignment/project) | Matches this school's actual continuous-assessment practice? |
| Payment allocation override | Oldest-term-first by default, Accountant can override per payment | n/a (behavior, not a setting) | Confirm this matches how the office already handles part-payments |
| Password policy | `password_min_length` | `10` | Any stricter institutional requirement? |
| Report card branding/format | n/a (template file) | Generic PDF layout | Any existing report card template to match? |
| Backup retention window | `backup_retention_daily_days` / `backup_retention_weekly_weeks` | `30` / `26` | Confirm against the school's own record-keeping policy |

## C. Accepted risks & known trade-offs (v1, by design)

Documented so nobody rediscovers these mid-build and treats them as bugs:

- **SQLite single-writer concurrency** — acceptable at this school's
  scale; mitigated by WAL mode and short bulk transactions (doc 15). Not
  a path to multi-school; purely a capacity note if this school's data
  volume ever grows unusually large.
- **No live payment gateway in v1** — payments are recorded manually
  (cash/bank/mobile-money reference), not processed via card/online
  checkout. Fast-follow, not launch-blocking (doc 16).
- **No native mobile app** — responsive web only for v1.
- **Notifications are in-app + email only, no SMS** — a deliberate
  channel choice, not a placeholder waiting on a provider (doc 10).
- **Single school only, permanently** — this is not a deferred
  limitation; there is no multi-tenant path being kept open (doc 01/02).
- **Credit carry-forward never crosses students** — a sibling can't
  receive another sibling's overpayment automatically; that requires a
  manual discount/adjustment instead (doc 08).

## D. Cross-module edge cases — quick reference

A consolidated index of the trickiest interactions already resolved in
the module docs, so they're easy to re-verify during implementation
instead of re-litigated:

| Scenario | Resolution | Doc |
|---|---|---|
| Student pays less than a term's fee | Invoice stays `partial` with a real balance; never merged into a later term | 08 |
| Student later pays enough to cover an old balance + more | Oldest-outstanding-invoice-first allocation settles old debt before anything becomes credit | 08 |
| Student overpays after all invoices are settled | Excess becomes `fee_credits`, auto-applied at next invoice generation or manually applied/refunded | 08 |
| Withdrawn student with an outstanding balance | Withdrawal is allowed but surfaces a warning; historical financial records are retained, never deleted | 07/08 |
| Attendance edited after the lock window | Requires an audited Admin override; never a silent edit | 09 |
| Exam results before publish | Invisible to students/parents even though marks exist in the DB; publish is all-or-nothing per scope | 12 |
| Coursework scores vs exam results visibility | Coursework visible to parents in near-real-time; exam/report-card results gated until explicit publish | 11/12 |
| Teacher access to another section's data | Blocked at the service layer via `staff_assignments` scoping, not just hidden in the UI | 04/13 |
| Discount bypass attempt via direct API call | Rejected server-side regardless of UI — approval gate lives in the service layer | 08/14 |
| Voiding a payment whose credit was already applied elsewhere | Void flow surfaces the dependency and requires resolving it first, not a silent inconsistency | 08 |

## E. Go/no-go checklist before Phase 0 kickoff

- [ ] All items in section A collected (or an explicit plan for who
      collects what by when).
- [ ] All items in section B reviewed with the school's Admin/Principal
      and defaults adjusted where needed — recorded back into the
      relevant module doc, not left only in a meeting note.
- [ ] Dev/staging/production environment plan agreed (doc 02
      "Environments") — where staging will actually run for UAT.
- [ ] Backup target/location decided (doc 14/15) — even before Phase 0,
      so it's not an afterthought once real data exists.
- [ ] `backend/` and `frontend/` project roots exist (scaffolded) per
      doc 02's folder structure, ready for Phase 0's first commits.
- [ ] Everyone building this has read docs 02–06 (architecture, stack,
      roles, schema, API conventions) — the shared foundation every
      module depends on — before starting Phase 0 tasks in `tasks.md`.
