# EduManage — Frontend

Next.js (App Router) + shadcn/ui (strict) + TypeScript (strict) frontend.
Phase 0 scaffold is in place: auth flow, app shell, shared
DataTable/FilterBar/form primitives, and the School Settings / System
Settings / Academic Years / Classes / Subjects screens wired to the
FastAPI backend in `../backend/`.

## Before changing anything here, read

- [`../docs/02-system-architecture.md`](../docs/02-system-architecture.md) — route groups by role, folder structure under `app/`/`components/`/`lib/`
- [`../docs/03-tech-stack-and-conventions.md`](../docs/03-tech-stack-and-conventions.md) — **shadcn/ui only, no other component library** — read this before adding any UI dependency
- [`../docs/17-ui-ux-guidelines.md`](../docs/17-ui-ux-guidelines.md) — spacing/type scale, required loading/empty/error/success states, layout patterns
- [`../docs/06-api-design-guidelines.md`](../docs/06-api-design-guidelines.md) — the API contract this app consumes
- [`../docs/tasks.md`](../docs/tasks.md) — Phase 0 frontend tasks

## Getting started

```bash
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL, defaults to http://localhost:8000/api/v1
npm run dev
```

The backend (`../backend/`) must be running separately at
`http://localhost:8000` for any authenticated screen to load data.

## Scripts

- `npm run dev` — start the dev server (Turbopack)
- `npm run build` — production build (must be zero TypeScript errors)
- `npm run lint` — ESLint

## Not yet built (Phase 0 scope)

- Users & Roles management screen — backend router isn't finished yet.
- Teacher/Parent/Student modules beyond a placeholder landing page —
  attendance, gradebook, exams, fees, communication all land in later
  phases per `../docs/16-implementation-roadmap.md`.
