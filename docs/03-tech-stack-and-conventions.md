# 03 — Tech Stack & Conventions

## Backend

| Concern | Choice | Notes |
|---|---|---|
| Language/runtime | Python 3.12+ | |
| Web framework | FastAPI | async, auto OpenAPI docs |
| Validation/schemas | Pydantic v2 | `Create`/`Update`/`Read` schema per resource |
| ORM | SQLAlchemy 2.0 (typed) | declarative models, `Mapped[]` typing |
| Migrations | Alembic | one migration per schema change, reviewed like code |
| Database | SQLite (WAL mode) | see doc 15 for scaling notes |
| AuthN | JWT (PyJWT or python-jose) + refresh-token table | access ~15 min, refresh ~7 days, rotated |
| Password hashing | `bcrypt` (used directly, not via `passlib` — `passlib` is unmaintained and breaks against modern `bcrypt` releases) | never plaintext, never reversible encryption |
| AuthZ | Custom RBAC dependency layer | see doc 04 |
| Background jobs | APScheduler (in-process) | reminders, digests, scheduled reports |
| ASGI server | Uvicorn (dev), Uvicorn behind Gunicorn workers (prod) | |
| Testing | pytest + `httpx.AsyncClient` + `pytest-asyncio` | unit + integration against a throwaway SQLite file |
| Lint/format | `ruff` (lint) + `ruff format` or `black` | enforced in CI |
| Type checking | `mypy` (or `pyright`) | run in CI |
| Dependency mgmt | `uv` or `poetry` | pinned lockfile committed |

### Backend conventions
- **Layering is one-directional**: `router → service → repository/model`.
  Routers contain no business logic; services contain no HTTP concerns.
- **One module = one vertical slice**: `models/fees.py`, `schemas/fees.py`,
  `services/fees.py`, `routers/fees.py` — mirrors the 7 functional modules
  plus `identity` (auth/users/roles) and `academics_core` (school/year/term/
  class/subject, shared by several modules).
- **All monetary values** stored as integers in minor currency units
  (cents) to avoid floating-point rounding errors; formatted at the
  presentation layer using whichever currency `system_settings.currency_code`
  is configured to (doc 05 §1) — the currency itself is a single admin
  setting, not hardcoded to USD/ZWL/ZiG or any other code (doc 01
  "Regional context" explains why, given Zimbabwe's currency history).
- **All datetimes** stored in UTC; converted to school-local timezone only
  at the presentation layer.
- **Every table** gets `id` (UUID or ULID, not auto-increment int, to avoid
  leaking sequential record counts), `created_at`, `updated_at`,
  `created_by`, `is_active` (soft delete where deletion isn't safe, e.g.
  a student with payment history is deactivated, never hard-deleted). This
  common set of columns is a single SQLAlchemy mixin, applied to every
  model rather than repeated (doc 02, "Code reuse").
- **No business logic in Pydantic validators beyond shape/format
  validation** — cross-entity rules (e.g. "can't record a payment greater
  than the outstanding balance") live in the service layer where they can
  be transactional and testable.

## Frontend

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router) | |
| Language | TypeScript (strict mode) | |
| UI kit | **shadcn/ui only — no other component library, ever** | Tailwind-based, generated into `components/ui`, fully owned/customizable. This includes tables, filter controls (select/combobox/date-range), dialogs, forms, charts — every visible UI element is a shadcn primitive or a composition of them, not a third-party widget library. |
| Styling | Tailwind CSS | design tokens for school branding (logo/colors) configurable |
| Data fetching | TanStack Query | server state cache, mutations, optimistic UI for e.g. attendance marking |
| Forms | React Hook Form + Zod | Zod schemas mirror backend Pydantic schemas field-for-field |
| Client state | React Context / Zustand (minimal) | only for cross-cutting UI state (sidebar, active school year), not server data |
| Auth | Custom JWT flow via httpOnly cookies + Next.js middleware | no third-party auth provider needed since roles are school-internal |
| Tables | shadcn `DataTable` (TanStack Table under the hood) | server-side pagination/sorting/filtering for large lists (students, payments) |
| Charts (attendance %, fee collection, performance trends) | `recharts` (shadcn's chart component wraps this) | stays inside the shadcn ecosystem |
| Testing | Vitest + React Testing Library (unit/component), Playwright (e2e critical flows: login, record payment, mark attendance, publish results) | |
| Lint/format | ESLint + Prettier | enforced in CI |

### Frontend conventions
- **Route groups by role area**: `(admin)`, `(teacher)`, `(parent)`,
  `(student)`, each with its own layout/nav; shared pages (e.g. a shared
  "view report card") are composed, not duplicated.
- **shadcn/ui only, no exceptions**: never hand-roll a UI primitive shadcn
  already provides, and never pull in a different component/widget
  library to fill a gap (date pickers, comboboxes, command menus, tables,
  charts included) — if a pattern isn't available as a standalone shadcn
  component, it's composed from existing shadcn primitives (as the
  official shadcn examples do, e.g. `Popover` + `Calendar` for a
  date-range filter, `Command` + `Popover` for a combobox). This is the
  single most important frontend rule in this project.
- **API access only through a single typed client** (`lib/api/*.ts`)
  generated/derived from the backend OpenAPI schema where practical, so
  frontend and backend contracts can't silently drift.
- **Every list/table view** that can grow large (students, payments,
  attendance records, notifications) uses server-side pagination — no
  "fetch everything and filter client-side" for core datasets.
- **Accessibility**: rely on shadcn/Radix's built-in a11y (focus traps,
  ARIA), but every custom composition is checked against keyboard-only
  navigation and screen-reader labeling before it's considered done.

## Code reuse conventions

Reuse is structural, not a style preference left to discipline — see doc
02's "Code reuse — shared building blocks" for the full list. The rules
that keep it that way as the codebase grows:

- **No module implements its own pagination, filtering, or soft-delete
  logic.** Every router depends on a shared `CommonListParams`
  (page/page_size/sort + a per-resource allow-listed filter set) and
  every repository extends `BaseRepository[Model]`. If a second module
  is about to copy-paste a list endpoint from a first, that's the signal
  to lift the shared piece instead.
- **One roster-bulk-entry implementation, not several.** Attendance
  marking and gradebook/exam score entry are the same shape of operation
  (see doc 02) — they share the backend helper and the frontend grid
  component. A third bulk-entry need (e.g. bulk fee-discount application)
  is built on the same helper, not a new one.
- **Before adding a new shadcn composition, check `components/shared/`
  first.** Tables, filter bars, forms, and bulk-entry grids are built
  once and imported, never re-derived per module.
- **A new dependency (frontend or backend) requires checking the existing
  stack first** — e.g. a new chart need reaches for the shadcn chart
  component already in place before considering another charting library.

## Cross-cutting conventions

- **API contract first**: for each module, agree the Pydantic
  schemas/endpoints (doc 06 + each module doc's "API Surface" section)
  before frontend work starts on that module.
- **Environment config** via `.env` files (never committed) + a typed
  settings object (`pydantic-settings` on the backend, `env.ts` validated
  with Zod on the frontend). Secrets never hardcoded.
- **Git workflow**: trunk-based with short-lived feature branches per task
  in `tasks.md`; PRs required even for a solo developer, to keep a review
  checkpoint and a working CI gate before merge.
- **CI (GitHub Actions or equivalent)**: on every PR — backend lint + type
  check + tests; frontend lint + type check + tests; block merge on
  failure. A separate "build" job verifies both apps actually build.
- **Versioning**: backend API is versioned at the URL (`/api/v1`);
  frontend and backend are versioned together per release tag until the
  system stabilizes enough to decouple.
