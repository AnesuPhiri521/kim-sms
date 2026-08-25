# 01 — Project Overview

## Vision

EduManage centralizes the day-to-day administrative and academic operations
of a school — money, attendance, communication, student records, and
academic performance — into one secure, role-aware system, replacing
spreadsheets and disconnected tools with a single source of truth.

## Business objectives

1. **Streamline Fee & Financial Management** — automate and centralize
   school fee management: student accounts, fee structures, payments,
   outstanding balances, receipts, discounts, and financial reports.
2. **Improve Student Attendance Management** — record, monitor, analyse,
   and report attendance; identify absenteeism; improve accountability.
3. **Strengthen School Communication & Notifications** — a centralized
   channel for admins, teachers, students, and parents/guardians to get
   timely notice of fees, attendance, academics, announcements, and events.
4. **Centralize Student Information Management** — a secure system of
   record for registration, personal info, guardians, academic history,
   class allocation, documents, attendance, and fees.
5. **Enhance Teacher & Student Academic Performance Management** — tools
   for grades, assessments, exams, comments, and progress, visible to
   schools and parents to spot students needing support.
6. **Automate Academic & Examination Management** — subjects, classes,
   exams, assessments, grading structures, report cards, results.
7. **Improve Teacher & Staff Management** — centralize staff records,
   assignments (teachers ↔ subjects ↔ classes), responsibilities, and
   staff attendance.

## Target users / personas

| Persona | Primary needs |
|---|---|
| **School Admin / Principal** | Full oversight: enrollment, finances, staff, reports, approvals |
| **Registrar / Front Office** | Student registration, document management, class allocation |
| **Accountant / Finance Officer** | Fee structures, payment collection, receipts, discounts, financial reports |
| **Teacher** | Owns exactly one class and teaches every subject in it — marks attendance, records grades/assessments across all subjects, compiles and signs off the report card, and is the point of contact for that class's parents |
| **Student** | View own timetable, attendance, grades, fee balance, announcements |
| **Parent/Guardian** | View their child(ren)'s attendance, fees, grades, receive notifications, pay fees |

## Scope — v1 (in scope)

- **Single school only.** This is not a multi-tenant/multi-school
  platform — one deployment, one school, no `school_id` scoping, no
  "manage schools" admin layer. Simplicity here is deliberate (see
  doc 02).
- All 7 modules above, web application only (responsive, not native mobile).
- Role-based access control with a fixed set of roles + granular
  permissions.
- SQLite as the database (see doc 15 for scaling notes/limits).
- Notifications via **in-app and email** — this is the school's chosen
  channel set; there is no SMS channel in this system.

## Out of scope — v1

- Native mobile apps (a responsive web app covers phones/tablets).
- **Simultaneous** multi-currency handling (e.g. tracking a balance in
  two currencies at once) and multi-country tax handling. The school
  still picks **one** currency via a configurable setting (see "Regional
  context" below) — that's a single admin-configurable value, not the
  multi-currency accounting this line excludes.
- Payroll processing for staff (staff *records* are in scope; payroll is not).
- Learning Management System features (course content delivery, e-learning).
- Multi-school/district administration — permanently out of scope, not a
  deferred feature. This system is built for exactly one school.
- Online payment gateway integration in v1 (fee *recording* of
  cash/bank/mobile-money payments is in scope; live card/gateway checkout
  is a fast-follow — see roadmap).

## Success metrics (per objective)

| Objective | Metric |
|---|---|
| Fees | % of payments recorded digitally vs manual; time to generate a receipt; accuracy of outstanding-balance reports |
| Attendance | % of classes with same-day attendance marked; time to identify chronic absenteeism |
| Communication | % of notifications delivered/read; reduction in "I didn't know" complaints |
| Student Info | Time to register a new student; % of records with complete guardian/document data |
| Academic Performance | Time to generate report cards; teacher adoption of grade entry |
| Examinations | Time from exam completion to published results |
| Staff | % of staff with complete records and correct class assignments |

## Assumptions & constraints

- **One school, one deployment, permanently** — not a v1-only
  simplification. No `school_id` column, no schools-admin layer,
  no multi-tenant migration path kept open. This keeps the data model
  and every query simpler than a multi-tenant design would allow.
- The school year is divided into **terms** — Admin defines how many per
  academic year and each one's name/start/end date (see docs 05 and 08).
  Nothing about term count is hardcoded; a new academic year is pre-filled
  with a **3-term template** (Term 1/2/3) matching standard Zimbabwean
  practice as a convenience default, which Admin can add to, rename, or
  remove terms from if this school's calendar differs. This is the
  time-boxing unit for fees, attendance summaries, and grading either way.
- **One teacher owns exactly one class and teaches every subject in
  it** — this is a primary/elementary-style staffing model, not a
  subject-specialist one. There is no separate "subject teacher" vs
  "class teacher" distinction anywhere in the system: being assigned a
  class *is* full ownership of that class's attendance, grading, and
  report card across all its subjects (see docs 05 and 13).
- The school spans **Grades 1–7**, and a grade can be split into more
  than one lettered **section** (e.g. "Grade 1 A", "Grade 1 B") —
  each section is a genuinely separate class with its own teacher,
  roster, attendance, and grades, not a sub-grouping of one shared
  class. The grade range itself (1–7) is captured as setup data, not
  hardcoded the way the 3-term rule is — the *shape* (grade → one or
  more sections, one teacher per section) is what the system enforces
  (see doc 05 §2).
- Internet connectivity at the school is assumed adequate for a web app;
  offline-first is not a v1 requirement.
- SQLite is a deliberate, explicit choice per requirements; doc 15 covers
  its limits (single-writer concurrency, no built-in replication) and the
  mitigations (WAL mode, connection pooling discipline, backup cadence,
  clear migration path to PostgreSQL if the school ever outgrows it —
  not a multi-school path, purely a capacity one).

## Regional context — Zimbabwe

This system is built for a Zimbabwean primary school, which shapes the
**defaults** used throughout this plan — every one of them is an
admin-configurable starting point, never a hardcoded assumption baked
into the schema (per the "everything should be configurable" principle
below).

- **Education structure**: Zimbabwean primary school runs Grade 1–7
  (after ECD A/B, which this school doesn't include per doc 05), ending
  in the national Grade 7 examination set by ZIMSEC. Primary school
  conventionally uses a **class-teacher model** — one teacher per class
  covering (nearly) every subject — which is exactly the staffing model
  already designed (docs 01/13), not something introduced to fit this
  system; it reflects how the school actually operates. Secondary
  school (Form 1–6, subject-specialist teachers) is a structurally
  different model and out of scope for this deployment.
- **School calendar**: the Ministry of Primary and Secondary Education
  (MoPSE) publishes a **3-term academic year** — roughly Term 1
  (January–April), Term 2 (May–August), Term 3 (September–December),
  with school holidays between terms — but exact dates shift year to
  year by ministry circular. That's exactly why term *dates* are
  Admin-entered per year rather than assumed, and now (per this round's
  change) why term *count/structure* itself is editable too, not fixed
  at 3 — the 3-term shape is offered as the default template, not
  enforced.
- **Currency**: Zimbabwe has had a volatile, multi-currency monetary
  environment — historically RTGS/Zimbabwean dollar, USD widely used
  for school fees (especially at private/mission/church-run schools),
  and ZiG (Zimbabwe Gold) introduced in 2024 as the latest local
  currency. Given this, the system treats currency as a single
  **admin-configurable setting** (`system_settings.currency_code`, doc
  05 §1) rather than hardcoding USD, ZWL, or ZiG — set it to whichever
  currency this school actually collects fees in, and change it if that
  changes. All monetary storage/formatting logic (doc 03) is
  currency-agnostic integer-minor-units regardless of which currency is
  configured.
- **Fee structure**: Zimbabwean schools commonly itemize fees beyond
  plain "tuition" — a development levy/building fund, PTA or School
  Development Committee (SDC/SDA) contributions, sports levy, ICT levy,
  and (particularly relevant for a Grade 7 cohort) examination fees.
  Doc 08's fee categories are fully admin-editable CRUD already; this
  just informs a sensible **seed list** so the school isn't starting
  from a blank slate (doc 08).
- **Curriculum/assessment**: the 2017 competency-based curriculum
  introduced **Continuous Assessment Learning Activities (CALA)** —
  ongoing school-based tasks that contribute to a learner's final grade
  alongside end-of-term tests. This is exactly the shape doc 11's
  configurable `assessment_types` + per-assessment weighting already
  supports; it informs the suggested default types (e.g. "CALA Task",
  "End of Term Test") rather than requiring new design. Primary schools
  under this curriculum also commonly grade with **descriptive bands**
  (e.g. "Below Expectation" / "Approaching Expectation" / "Meets
  Expectation" / "Exceeds Expectation") rather than strict A–F letters —
  doc 05's `grading_scales.letter_grade` is a free-text label for
  exactly this reason, not limited to single letters.

**Principle: everything above is configurable, not hardcoded.** Where
earlier drafts of this plan hardcoded a business rule because "this is
just how it works" (the term count, in particular), that's been
corrected — see doc 18 §B, now backed by a concrete `system_settings`
table (doc 05 §1) rather than scattered prose promises of
configurability.
