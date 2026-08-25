# 14 — Security Best Practices

A checklist-style reference applied across all modules. Items here are
requirements, not suggestions — `tasks.md` turns each into a trackable
task.

## Authentication

- Passwords hashed with `bcrypt` or `argon2` (never MD5/SHA1, never
  reversible encryption, never plaintext).
- JWT access tokens short-lived (~15 min); refresh tokens long-lived but
  rotated on every use, tracked server-side in `refresh_tokens` so they
  can be revoked (logout, offboarding, suspected compromise).
- Refresh-token reuse detection: if a already-rotated refresh token is
  presented again, revoke the entire token family — signals a possible
  stolen cookie.
- Refresh token delivered only via httpOnly, `Secure`, `SameSite=strict`
  cookie — never accessible to JavaScript, never returned in a JSON body.
- Account lockout after N consecutive failed logins, with notification to
  the account owner.
- Password reset via time-limited, single-use signed token sent by
  email; resetting a password invalidates all existing sessions for that
  account.
- No self-registration for staff/admin roles — accounts are created by
  Admin/Registrar or via a signed invite link, closing off an entire
  class of unauthorized-account-creation risk.

## Authorization

- Every route declares a required permission via a dependency
  (`require_permission("fees:record_payment")`) — checked server-side on
  every request, never trusted from the frontend alone.
- Data-scoping (doc 04) enforced in the **service/repository layer**, not
  left to be remembered per-endpoint — e.g. the shared `BaseRepository`
  (doc 02) is where parent/student/teacher/staff-assignment scoping
  filters live, reused by every module's repository rather than
  reimplemented per endpoint.
- Principle of least privilege in the seeded role/permission set (doc 04)
  — a role gets exactly the permissions its job needs, not broad access
  "just in case."
- Maker/checker (dual control) on sensitive actions: discount approval,
  large refunds/voids, published results/report cards — one role
  proposes, a different, more senior role approves.

## Input validation & injection prevention

- All request bodies validated through Pydantic schemas — no
  hand-parsed JSON, no untyped dict access.
- All DB access through the SQLAlchemy ORM with parameterized
  queries — no raw string-interpolated SQL, anywhere.
- File uploads (documents, photos) validated on: file type
  (allow-list, not deny-list), size limit, and content sniffing (don't
  trust the extension alone) before storage; stored outside the web
  root with generated filenames (never trust user-supplied filenames on
  disk).

## Frontend security

- CSRF: since auth uses an httpOnly cookie for the refresh token,
  state-changing requests require either a custom header
  (`X-Requested-With`) the browser won't attach cross-site, or a CSRF
  token pattern — decided and applied consistently, not ad hoc per form.
- XSS: React/Next.js escapes by default; any place that must render
  server-provided HTML (e.g. a rich-text announcement body, if ever
  added) is sanitized server-side before storage, not just trusted.
- No sensitive data (full JWT payloads, other users' data) ever placed
  in `localStorage`; the access token is held in memory / a short-lived
  cookie, not `localStorage`, to reduce XSS blast radius.

## Data protection & privacy

- Student and financial data are sensitive by nature: access is
  strictly role- and relationship-scoped (doc 04) — a parent can only
  ever query their own linked children, enforced server-side.
- PII fields (DOB, medical notes, guardian contact info) are only
  returned in API responses to roles that need them — e.g. a class
  roster endpoint for a Teacher returns names/photos, not medical notes.
- `audit_logs` capture who accessed/changed sensitive records
  (payments, grades, attendance edits after lock, role changes) with
  before/after values, for accountability and incident investigation.
- Backups (doc 15) are stored encrypted at rest if the hosting
  environment supports it; access to backup files is restricted to
  Admin/ops, not general staff.

## Transport & infrastructure

- HTTPS enforced end-to-end in staging/production (HTTP→HTTPS redirect,
  HSTS header); local dev may use plain HTTP.
- CORS configured with an explicit allow-list of the frontend's origin(s)
  — never `*` alongside credentialed requests.
- Secrets (JWT signing key, SMTP credentials) loaded from environment
  variables / a secrets manager, never committed to the repo; `.env`
  files gitignored, an `.env.example` documents required keys without
  values.
- Rate limiting on auth endpoints (`/auth/login`, `/auth/forgot-password`)
  to blunt brute-force/credential-stuffing attempts, independent of the
  account-lockout mechanism above.
- Dependency scanning (e.g. `pip-audit` / `npm audit` or Dependabot) run
  in CI to catch known-vulnerable packages before they ship.

## Auditability

- Every financial transaction, every attendance/grade edit after lock,
  every role/permission change, every account status change is written
  to `audit_logs` in the same DB transaction as the change (not
  best-effort/async) — see doc 06.
- Audit logs are append-only from the application's perspective (no
  update/delete endpoint exposed for them).

## Testing & review

- Security-relevant code paths (auth, permission checks, payment
  handling) get explicit test coverage, not just happy-path tests —
  including "does a Teacher get 403 trying to read another section's
  attendance," "does an over-payment get rejected," "does an expired
  refresh token get rejected."
- New endpoints are reviewed against this checklist before merge (a
  lightweight version becomes a PR template checklist item).

## Backup & recovery (see also doc 15)

- Automated nightly backup of the SQLite database file (with WAL
  checkpoint before copy to ensure consistency) plus the document/
  receipt file storage directory.
- Periodic restore-drill: a backup is only as good as its last verified
  restore.
