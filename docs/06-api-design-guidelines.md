# 06 — API Design Guidelines

These conventions apply to every endpoint across all 7 modules so the API
surface feels like one system, not seven bolted together.

## Base URL & versioning

- All endpoints under `/api/v1/...`. A breaking change bumps to `/api/v2`
  rather than mutating `v1` in place; additive changes (new optional
  field, new endpoint) don't require a version bump.
- Auto-generated OpenAPI schema is served at `/api/v1/openapi.json`,
  interactive docs at `/docs` (Swagger) and `/redoc` — this is the
  contract the frontend's typed client is derived from.

## Resource naming

- Plural nouns, kebab/lower-case: `/students`, `/fee-invoices`,
  `/attendance-sessions`, `/exam-schedules`.
- Nesting only for genuinely owned sub-resources, max one level deep:
  `/students/{student_id}/documents`, `/sections/{section_id}/attendance-sessions`.
  Cross-cutting queries (e.g. "all payments for a term regardless of
  student") stay top-level with query params: `/fee-payments?term_id=...`.
- Actions that aren't pure CRUD are modeled as sub-resource POSTs, not
  verbs in the path where avoidable: `/students/{id}/fee-payments`
  (record a payment, auto-allocated across that student's outstanding
  invoices — doc 08), `/exams/{id}/publish` (state transition — the one
  place a verb is acceptable, since "publish" isn't a resource).

## Standard response envelope

```json
{
  "data": { ... },
  "meta": { "page": 1, "page_size": 25, "total": 134 }
}
```

- `meta` is present for list endpoints, omitted for single-resource
  endpoints.
- List endpoints always return `data` as an array, never bare arrays at
  the top level, so `meta` always has somewhere to live and the shape is
  future-proof.

## Errors

```json
{
  "error": {
    "code": "FEE_INVOICE_OVERPAYMENT",
    "message": "Payment amount exceeds the outstanding balance.",
    "field_errors": [ { "field": "amount_cents", "message": "..." } ]
  }
}
```

- HTTP status communicates the category (`400` validation, `401`
  unauthenticated, `403` unauthorized/permission denied, `404` not found,
  `409` conflict/state error, `422` semantic validation, `500` unexpected).
- `error.code` is a stable, machine-readable string the frontend can
  branch on (e.g. show a specific dialog for `FEE_INVOICE_OVERPAYMENT`);
  `error.message` is human-readable and safe to show directly; internal
  exception details are **never** leaked into the response (logged
  server-side only) — see doc 14.

## Pagination, filtering, sorting

- Offset pagination via `page` / `page_size` (default 25, max 100) for
  v1 — simple and sufficient at single-school scale; every list response
  includes `total` so the frontend can render page controls.
- **Every list endpoint in every module is filterable** — this is a
  baseline requirement, not an optional extra per resource. Filtering is
  via explicit, per-resource query params (not a generic query language)
  so each one is validated and indexable: `?section_id=...&status=unpaid`.
- Sorting via `?sort=field` / `?sort=-field` (leading `-` = descending),
  restricted to an allow-list of sortable columns per resource to keep
  queries index-friendly.
- **Reused, not reinvented, per endpoint.** Every list route declares its
  filters by extending one shared `CommonListParams` dependency
  (`page`, `page_size`, `sort`) plus a small resource-specific filter
  schema; the shared dependency and the `BaseRepository` it feeds (doc 02)
  do the actual query-building, so pagination/filtering/sorting behave
  identically everywhere instead of drifting module to module.
- **Baseline filter set every list resource supports, where applicable**:
  a relevant date/period scope (`term_id`, `academic_year_id`, or a
  `from_date`/`to_date` range), a status field (`status=unpaid`,
  `status=active`, ...), and the natural parent scope (`section_id` for a
  roster-shaped resource, `student_id` for a per-student history). Module
  docs (07–13) list the specific filters for each resource; anywhere a
  module doc doesn't spell them out, this baseline still applies.
- Frontend: filters are rendered by the shared `<FilterBar>` component
  (doc 02/03) from a declarative per-screen field config, always backed
  by shadcn controls (`Select`, `Combobox`, `Popover`+`Calendar` for date
  ranges) — never a bespoke filter UI per screen.

## Auth

- `Authorization: Bearer <access_token>` header on every request except
  `/auth/login`, `/auth/refresh`, `/auth/forgot-password`.
- Refresh token travels only as an httpOnly, secure, `SameSite=strict`
  cookie — never accessible to JS, never sent in a JSON body.
- `403` responses distinguish "not authenticated" (`401`) from
  "authenticated but not permitted" (`403`) so the frontend can route to
  login vs. an "access denied" state correctly.

## Idempotency (payments & other money-moving writes)

- Endpoints that record a financial transaction
  (`POST /students/{id}/fee-payments`) accept an `Idempotency-Key` header;
  a retried request with the same key returns the original result instead
  of creating a duplicate payment — protects against double-submission on
  flaky connections, which matters more for money than for most resources.

## Write-endpoint conventions

- `POST` creates and returns `201` + the created resource.
- `PATCH` (not `PUT`) for partial updates — matches how forms in the UI
  submit only changed fields.
- Destructive deletes are soft (`is_active = false` / status transitions
  like `withdrawn`, `void`) for anything with financial or academic
  history; hard `DELETE` is reserved for genuinely disposable data (e.g.
  a draft announcement never published).
- Every state-changing endpoint that matters for accountability
  (payments, grade changes, attendance edits after lock, discount
  approvals, role changes) writes an `audit_logs` row in the same
  transaction as the change — not best-effort/async, so it can't silently
  fail to record.

## Bulk operations

- Attendance marking and grade entry are inherently bulk (a whole class at
  once), so those two modules expose bulk endpoints
  (`POST /attendance-sessions/{id}/records:bulk`,
  `POST /assessments/{id}/scores:bulk`) accepting an array and returning
  per-row success/failure, rather than forcing the frontend into N
  sequential requests.

## Reports & exports

- Report/export endpoints (`/reports/fee-collection`,
  `/reports/attendance-summary`, `/reports/report-cards/{student_id}.pdf`)
  return either JSON (for on-screen charts/tables) or a generated file
  (CSV/PDF) based on `Accept` header or an explicit `?format=` param, kept
  consistent across all modules rather than each module inventing its own
  export mechanism.
