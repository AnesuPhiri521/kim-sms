# 15 — Non-Functional Requirements

## Performance

- List/table endpoints for large datasets (students, payments,
  attendance records) must be server-paginated with indexed filter
  columns (doc 05) — no "load everything, filter in the browser."
- Target: p95 API response time under 300ms for standard CRUD/list
  operations at expected single-school data volumes (hundreds to a few
  thousand students).
- Report/aggregate endpoints that require heavier computation (term
  performance analytics, attendance summaries) are backed by
  pre-computed/derived tables (`attendance_daily_summary`,
  `absenteeism_flags`) refreshed by background jobs rather than computed
  on every request.
- Bulk operations (attendance marking, score entry) are single
  transactional requests, not N sequential HTTP calls from the frontend.

## Scalability & SQLite limits

- SQLite is a deliberate choice for this deployment scale (single
  school, moderate concurrent users). Known limits and mitigations:
  - **Single-writer concurrency**: WAL mode allows concurrent readers
    with one writer; write-heavy bursts (e.g. everyone marking
    attendance at 8am) are expected to be short transactions, kept
    fast intentionally (bulk endpoints, not row-by-row).
  - **No built-in replication**: mitigated by the backup strategy below;
    acceptable at this scale since a single school's traffic doesn't
    require read-replica scaling.
  - **File size**: not a practical concern until data volumes are
    orders of magnitude beyond a single school's scale.
- **Documented migration path**: because the ORM layer (SQLAlchemy) and
  service-layer architecture (doc 02) don't hardcode SQLite-specific SQL,
  moving to PostgreSQL later (if this one school's own data volume ever
  outgrows SQLite) is a connection-string + Alembic-dialect change plus a
  data migration — not a rewrite. This is purely a capacity path for the
  single school this system serves, not a step toward multi-tenancy,
  which remains explicitly out of scope (doc 01).

## Availability & backup

- Automated nightly backup (WAL checkpoint → copy DB file → copy
  document storage) to a separate location from the live server.
- Backup retention: e.g. daily for 30 days, weekly for 6 months
  (finalized with the school based on their comfort/compliance needs).
- Documented, periodically-tested restore procedure — an untested
  backup is not a real backup.
- Target uptime appropriate to a single-school administrative tool
  (not a 24/7 mission-critical system): scheduled maintenance windows
  communicated in advance are acceptable.

## Observability

- Structured logging (JSON logs) from the backend, including request
  ID correlation, so a user-reported issue can be traced through the
  logs.
- Error tracking (e.g. Sentry or equivalent) capturing unhandled
  exceptions in both frontend and backend with enough context to
  reproduce, without leaking sensitive data (payment details, PII) into
  the error tracker.
- Background job outcomes (notification sends, absenteeism detection,
  invoice generation) are logged with success/failure counts so a
  silently-failing job is visible, not just silent.
- Admin-visible health indicators: last successful backup time, last
  notification-job run, any persistently-failing external integration
  (e.g. SMTP misconfigured).

## Accessibility

- shadcn/ui (built on Radix primitives) provides strong accessibility
  defaults (keyboard navigation, focus management, ARIA roles) — every
  custom composition built from these primitives is checked against
  keyboard-only use and screen-reader labeling before being considered
  done, not assumed automatically correct.
- Color is never the only signal for status (e.g. attendance
  present/absent/late uses icon + text + color, not color alone) —
  relevant for colorblind users.
- Target: WCAG 2.1 AA for core workflows (login, attendance marking,
  payment recording, viewing grades/fees).

## Internationalization

- Not a hard v1 requirement, but text is not hardcoded inline where it
  can reasonably be centralized (e.g. UI copy in shared constants/i18n
  message files even if only one locale ships initially) so adding a
  second language later doesn't require hunting through components.
- Dates/currency are formatted using the school's configured
  locale/timezone (doc 02), not assumed to be the developer's locale.

## Maintainability

- Domain-oriented folder structure (doc 02/03) keeps each module's
  backend and frontend code cohesive, so a change to one module rarely
  requires touching unrelated modules.
- Every schema change goes through a reviewed Alembic migration — no
  manual/undocumented DB edits in any environment.
- CI gate (lint, type check, tests) blocks merges that would silently
  break another part of the system.

## Compliance & data retention

- Financial records (invoices, payments, receipts) are retained
  indefinitely by default (never hard-deleted) to satisfy typical
  school financial record-keeping expectations — exact retention
  period confirmed with the school's own policy/local regulation during
  setup.
- Withdrawn/graduated student records are retained (not deleted) for
  historical/transcript purposes, with access still governed by RBAC.
