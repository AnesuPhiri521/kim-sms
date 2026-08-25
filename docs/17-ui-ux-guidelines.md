# 17 — UI/UX Guidelines

"Nice and clean" is a spec, not a vibe — this doc turns it into concrete,
checkable rules that apply to every screen in every module. It sits on
top of doc 03's "shadcn/ui only" rule: this doc is *how* those primitives
are composed and laid out, not a different toolset.

## Visual foundation

- **One spacing scale, used everywhere**: Tailwind's default scale
  (4px increments) via shadcn's tokens — no arbitrary one-off pixel
  values in component styles. Card padding, form field gaps, and page
  margins each pick one step on the scale and stay consistent across
  every module, not decided per screen.
- **One type scale, used everywhere**: page titles, section headers,
  card titles, body text, and helper/muted text each map to a fixed
  Tailwind text-size + weight combination, defined once (e.g. in a
  `typography.ts` constants file or Tailwind theme extension) and reused
  — never an ad hoc `text-[15px]` invented per screen.
- **Color is semantic, not decorative**: shadcn's theme tokens
  (`primary`, `muted`, `destructive`, `success` if added, `border`) are
  used for their meaning — destructive actions are only ever the
  destructive color, status badges (paid/overdue/present/absent) use a
  fixed, documented color-to-status mapping applied consistently across
  every module rather than each screen picking its own.
- **Density**: administrative screens (Admin/Accountant/Registrar) favor
  information density — compact `DataTable` rows, tight card layouts,
  since these users work through many records. Parent/Student-facing
  screens favor generous whitespace and larger touch targets, since
  they're occasional, often mobile users. Same components, different
  density presets — not a different design system.

## Layout patterns (reused, not reinvented per screen — doc 02/03 code reuse)

- **List screen** = page header (title + primary action button, e.g.
  "+ Add Student") + `<FilterBar>` + `<DataTable>` + pagination footer.
  Every list screen across all 7 modules follows this exact shape.
- **Detail/profile screen** = header card (identity + key stats) +
  `Tabs` for sub-sections (e.g. student profile's Overview/Guardians/
  Documents/Attendance/Fees/Academics). No detail screen invents its own
  top-level layout.
- **Form screen/dialog** = shadcn `Form` in a `Dialog` for quick
  create/edit (fee category, discount, announcement), a full page for
  multi-step or heavy forms (student registration wizard, report card
  compilation). The rule: if it fits in one glance, it's a dialog; if it
  needs scrolling or multiple steps, it's a page.
- **Dashboard/report screen** = summary `Card` row (key metrics) above a
  chart/table detail area, filterable by the same `<FilterBar>` pattern.

## Required states — every screen that fetches or submits data

A screen isn't done until all four of these are handled, not just the
happy path:

1. **Loading**: shadcn `Skeleton` matching the shape of the content that
   will appear (a table skeleton for a table, a card skeleton for a
   card) — never a bare spinner for content-shaped areas, and never a
   blank white screen.
2. **Empty**: a dedicated empty state (icon + short message + primary
   action where relevant — e.g. "No students yet — Add your first
   student") for every list/table, not just a blank table with headers.
3. **Error**: an inline error state (not just a toast that disappears)
   for anything that failed to load, with a retry action where
   retrying makes sense.
4. **Success/in-progress feedback for mutations**: shadcn `Sonner`/toast
   for confirmations ("Payment recorded", "Attendance saved"), a
   disabled + loading-spinner button state while a submit is in flight
   (never a double-submittable button), and inline field errors from
   Zod validation shown next to the field, not just in a toast.

## Forms & data entry

- Every form uses the shared `useEntityForm()` pattern (doc 02/03):
  Zod schema validation, inline field errors, disabled submit while
  invalid or submitting.
- **Destructive or hard-to-reverse actions get a confirmation dialog**
  (shadcn `AlertDialog`) that states the consequence in plain language
  — "This will void payment #1042 and cannot be undone" — not a generic
  "Are you sure?". Applies to: voiding a payment, withdrawing a student,
  deactivating staff, rejecting a discount, publishing exam results
  (irreversible in effect even if technically re-editable), refunding a
  credit.
- **Money and score fields** use a masked/formatted numeric input
  (currency formatting, decimal handling) so a typo can't silently
  submit $3000 instead of $30.00 — client-side formatting only, the
  server is still the source of truth for validation (doc 06).
- Bulk-entry grids (attendance, gradebook, exam marks — doc 02's shared
  `<RosterBulkGrid>`) support keyboard navigation (tab/arrow between
  cells) since a teacher entering 30 rows by mouse alone is a bad
  experience.

## Responsive & accessibility baseline

- Every screen is usable at a phone viewport (parents are the most
  likely mobile users) — `<DataTable>` collapses to a card-per-row
  layout below a defined breakpoint rather than forcing horizontal
  scroll for primary data.
- Color is never the only status signal (doc 15) — status badges pair
  color with text/icon (e.g. a red badge that also says "Overdue", not
  just a red dot).
- Every interactive element is reachable and operable by keyboard alone;
  every icon-only button has an accessible label (shadcn/Radix defaults
  handle most of this — verified, not assumed, per doc 15).
- Minimum contrast ratios (WCAG AA) are checked when any custom color is
  introduced beyond the shadcn theme tokens — which should be rare.

## Consistency checklist (applied before a screen is considered done)

- [ ] Built from shared components (`<DataTable>`, `<FilterBar>`,
      `<RosterBulkGrid>`, form pattern) — nothing hand-rolled that a
      shared component already covers.
- [ ] Loading, empty, error, and success states all implemented.
- [ ] Destructive actions confirm with a specific consequence message.
- [ ] Works at mobile width without horizontal scroll on primary content.
- [ ] Spacing/typography pulled from the shared scale, not one-off values.
- [ ] Status/role-appropriate: an Accountant screen is dense, a Parent
      screen is spacious — matches the density guidance above.
