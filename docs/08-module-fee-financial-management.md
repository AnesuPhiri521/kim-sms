# 08 — Module: Fee & Financial Management

> **Objective:** Automate and centralize school fee management: student
> accounts, fee structures, payments, outstanding balances, receipts,
> discounts, and financial reports.

## Key entities

`fee_categories`, `fee_structures`, `student_fee_overrides`, `discounts`,
`student_discounts`, `fee_invoices`, `fee_payments`, `fee_credits`,
`fee_credit_applications`, `receipts`, `fee_ledger` (doc 05, section 5).
Every fee structure and invoice is scoped to one of the school's three
fixed terms (`terms.term_number` 1/2/3, doc 05 §2) — there is no
"add a term" concept inside this module; terms are configured once,
school-wide, in the academic calendar.

## Roles & permissions

| Action | Role(s) |
|---|---|
| Define fee categories/structures | Accountant, Admin |
| Generate invoices for a term | Accountant, Admin |
| Record a payment, issue receipt | Accountant, Admin |
| Create a discount/scholarship | Accountant, Admin |
| **Approve** a discount above threshold | Principal, Admin |
| Void/refund a payment | Admin (Accountant can request, Admin approves) |
| Apply or refund a carried-forward credit | Accountant, Admin |
| View financial reports incl. per-term history | Accountant, Admin, Principal |
| View own balance, per-term history & pay | Parent, Student (view only) |

Codes: `fees:manage_structure`, `fees:generate_invoices`,
`fees:record_payment`, `fees:void_payment`, `fees:create_discount`,
`fees:approve_discount`, `fees:manage_credit`, `fees:report`,
`fees:view_own`.

## Core features / user stories

1. **Fee structure setup**: Accountant defines categories (seeded with
   Zimbabwean-typical levies — Tuition, Development Levy, PTA/SDC,
   Sports, ICT, Examination Fee — doc 05 §5, freely editable) and
   per-class/section amounts for each of the academic year's configured
   terms (Term 1/2/3 by default, doc 05 §2, but not assumed fixed —
   Admin manages the term list itself at the academic-year level). This
   module doesn't create or number terms — it just bills against
   whatever terms exist for the year. All amounts are recorded in
   whatever currency `system_settings.currency_code` is set to (default
   `USD` — doc 01 "Regional context"; the school changes this if it
   actually collects fees in a different currency). Structures are
   versioned by academic year so historical invoices remain correct even
   if next year's fees change.
2. **Invoice generation**: a batch job/action generates `fee_invoices` for
   every active student in scope when a term's structures are finalized;
   individual overrides (`student_fee_overrides`) handle exceptions
   (e.g. a student with a partial-year enrollment). If the student has
   **available credit** from a prior term's overpayment (see below), it
   is automatically applied to the new invoice at generation time, up to
   the invoice's `amount_due_cents`.
3. **Underpayment (partial payment)**: a payment is never required to
   cover an invoice in full. Example: Term 1 tuition is $50, the parent
   pays $30 → the invoice moves to status `partial` with a **remaining
   balance of $20**, which stays attached to that Term 1 invoice and
   keeps showing as owed — including after Term 2 starts — until it's
   settled by a later payment. It is never quietly merged into or hidden
   behind Term 2's own charge; the Term Fee History view (feature 7)
   shows Term 1 sitting at "$20 balance, partial" independently of
   whatever Term 2 shows.
4. **Payment recording & allocation order**: Accountant records a payment
   for a student (cash/bank transfer/mobile money/cheque/card-manual); a
   `receipt` is generated automatically. A payment isn't tied to a single
   invoice — it's **allocated across the student's outstanding invoices,
   oldest term first, by default**: if Term 1 still has that $20 balance
   from the example above and the parent later pays $40, $20 auto-settles
   Term 1 (bringing it to `paid`) and the remaining $20 goes toward
   Term 2, rather than the payment landing on whichever invoice happens
   to be "current." Accountant can override this and target a specific
   invoice manually when needed (e.g. a category dispute). This one
   allocation rule is what makes underpayment-then-catch-up and
   deliberate overpayment behave consistently, instead of being two
   separate mechanisms.
5. **Overpayment & credit carry-forward**: only once *every* outstanding
   invoice — current and any earlier unpaid balance — is fully settled
   does any leftover from a payment become a `fee_credits` row for that
   student (an underpaid Term 1 and a "credit" can never coexist — the
   oldest-first rule in feature 4 guarantees old debt is cleared before
   anything counts as advance credit). That credit is then:
   - **auto-applied** to the student's next-generated invoice (Term 2
     credit → Term 3 invoice, for example) at invoice-generation time,
     up to the amount needed to zero that invoice out — feature 2 above;
   - or **manually applied** by Accountant/Admin to a specific existing
     invoice at any time (`fee_credit_applications`), e.g. to apply it
     immediately rather than waiting for next-term generation;
   - or **refunded** instead of carried forward, if the family requests
     cash back — an explicit action, fully audited, distinct from a
     payment void.
   A credit can be split across multiple invoices if it's larger than one
   term's balance; `fee_credits.amount_remaining_cents` tracks what's left
   as it's drawn down.
6. **Discounts & scholarships**: percentage or fixed, scoped to a
   category, a fee structure, or an individual student; discounts above
   `system_settings.fee_discount_approval_threshold_cents` (doc 05 §1)
   require Principal/Admin approval before they apply (maker/checker —
   doc 14).
7. **Outstanding balance & per-term tracking**: every student's live
   balance is derived from the append-only `fee_ledger` (never a single
   mutable field alone), so it's always reconstructable/auditable. Just
   as importantly, the ledger is queryable **per term**, giving a clear
   history — for every student, at a glance: Term 1 (billed / paid /
   credit applied / balance / status), Term 2 (same), Term 3 (same) —
   across the current year and past years. This is the primary "easy
   tracking of what's been paid per term" view (see UI screens below).
8. **Receipts**: sequential receipt numbers; PDF generated and stored,
   downloadable by Accountant and by the paying parent/student.
9. **Refunds/voids**: a payment can be voided (with a mandatory reason)
   which writes a reversing `fee_ledger` entry rather than deleting the
   original — full history is preserved.
10. **Financial reports**: collection rate by term/class, outstanding
    balances list, discount utilization, payment-method breakdown,
    day/week/term collection totals, credit-balance liability (total
    unapplied credit outstanding — a real liability the school should be
    able to see).
11. **Parent-facing balance & payment**: parents see a running balance,
    the same Term 1/2/3 history breakdown, and payment history for each
    linked child; can record an "I paid via [method], here's my
    reference" pending payment for Accountant to confirm (v1: manual
    reconciliation; live gateway checkout is a fast-follow, see doc 16).

## API surface (high level)

```
GET/POST/PATCH  /api/v1/fee-categories
GET/POST/PATCH  /api/v1/fee-structures                 filter: term_id, academic_year_id, class_id, section_id, fee_category_id
POST            /api/v1/fee-structures/{id}/generate-invoices

GET             /api/v1/fee-invoices                    filter: student_id, section_id, class_id, term_id, status, from_due_date, to_due_date
GET             /api/v1/fee-invoices/{id}

POST            /api/v1/students/{id}/fee-payments        record a payment for a student (idempotency-key required); body: { amount_cents, method, reference_no, notes, allocations?: [{fee_invoice_id, amount_cents}] } — omit `allocations` to auto-allocate oldest-outstanding-invoice-first; any amount left over after all outstanding invoices are covered becomes a fee_credits row
GET             /api/v1/fee-payments                     filter: student_id, term_id, method, from_date, to_date, received_by_staff_id
GET             /api/v1/fee-payments/{id}                 incl. its `fee_payment_allocations` breakdown
POST            /api/v1/fee-payments/{id}/void

GET/POST        /api/v1/discounts
POST            /api/v1/discounts/{id}/apply/{student_id}
POST            /api/v1/student-discounts/{id}/approve
POST            /api/v1/student-discounts/{id}/reject

GET             /api/v1/students/{id}/fee-credits         filter: status
POST            /api/v1/fee-credits/{id}/apply             body: { fee_invoice_id, amount_cents }
POST            /api/v1/fee-credits/{id}/refund

GET             /api/v1/students/{id}/fee-ledger           filter: term_id, entry_type, from_date, to_date
GET             /api/v1/students/{id}/fee-balance
GET             /api/v1/students/{id}/fee-terms-summary     Term 1 / Term 2 / Term 3 breakdown (billed/paid/credit/balance/status) for a given academic year
GET             /api/v1/receipts/{id}.pdf

GET             /api/v1/reports/fee-collection             filter: term_id, class_id, from_date, to_date
GET             /api/v1/reports/outstanding-balances        filter: term_id, class_id, min_balance_cents
GET             /api/v1/reports/fee-credit-liability
```

## UI screens

- **Fee structures** admin table + form (shadcn `DataTable`, `Dialog` +
  `Form`), filterable by term/class via the shared `<FilterBar>`.
- **Invoice/billing dashboard**: outstanding balances table with the
  shared `<FilterBar>` (term, class/section, status, overdue), bulk
  reminder trigger (→ doc 10).
- **Student fee ledger view**: chronological ledger (`Table`, filterable
  by term/entry type) + summary `Card`s (billed / paid / credit applied /
  balance).
- **Term Fee History** (the primary "easy tracking" view, on the student
  profile and in the parent view): a compact table with **one row per
  configured term** for the selected academic year (Term 1/2/3 by
  default, but however many terms actually exist) — each row showing
  amount billed, amount paid, credit applied, remaining balance, and
  status (`paid`/`partial`/`overdue`/`unpaid`), with a year switcher for
  past academic years. Built from the shared `<DataTable>`, not a
  one-off table, and never assumes a fixed row count.
- **Record payment dialog**: amount, method, reference, and a live
  **allocation preview** showing exactly how the amount will be split —
  oldest outstanding invoice first (e.g. "$20 → settles Term 1 balance,
  $20 → Term 2") — with a manual override to redirect the split to a
  specific invoice instead of the default. If the amount exceeds every
  outstanding invoice combined, the remainder is shown as "→ becomes
  carried-forward credit," with a "refund instead" alternative surfaced,
  not hidden.
- **Credit management**: a student's available-credit `Card` (on their
  fee ledger view) with explicit "apply to an invoice" and "refund"
  actions, and a running list of past credit applications for audit
  visibility.
- **Discount management**: request/approve workflow with an `approve` /
  `reject` action visible only to Principal/Admin, pending list badge.
- **Financial reports dashboard**: charts (collection rate over time,
  by-category breakdown, per-term comparison) using shadcn's chart
  components, all driven by the same `<FilterBar>` pattern.
- **Parent view**: simplified balance card + the same Term 1/2/3 history
  table + payment history + "make a payment" flow, per child (tab/switcher
  if multiple children).

## Business rules & edge cases

- **Underpayment is a normal, expected state, not an error.** An invoice
  can sit at `partial` indefinitely with a positive balance (the $50
  due / $30 paid / $20 balance example above); nothing forces full
  payment at once, and no later term's invoice is blocked or altered by
  an earlier term's unpaid balance — it just keeps showing as owed.
- **Payment allocation defaults to oldest-outstanding-invoice-first** and
  this is enforced in the service layer, not left to the UI to get
  right: a payment amount is walked across the student's unpaid/partial
  invoices ordered by `due_date`, filling each one before moving to the
  next, with any true remainder after all of them becoming a
  `fee_credits` row. This one rule is what makes underpayment-catch-up
  and overpayment-carry-forward the same mechanism instead of two
  separate ones that could disagree with each other.
- A payment **may** bring the total paid across a student's invoices
  above what's currently due — this is allowed by design (not an error
  case) and, once every outstanding invoice is covered, the excess is
  captured as a `fee_credits` row in the same transaction as the
  payment, never silently discarded and never simply rejected.
- Credit auto-application at invoice generation only ever applies to
  **that same student's own** invoices — credit is never auto-shared
  across siblings; a manual cross-student application is out of scope
  (a discount/adjustment is the right tool if the school wants to give
  one student's excess to a sibling).
- A credit can be applied across more than one future invoice if it's
  larger than a single term's balance; `fee_credit_applications` records
  each partial draw-down, and `fee_credits.status` moves
  `available → partially_applied → fully_applied`.
- Refunding a credit (instead of carrying it forward) requires a reason
  and is audited exactly like a payment void.
- Voiding a payment requires a reason and is itself audited; it does not
  delete the original payment row. If voiding a payment that had
  generated a credit which has since been partially or fully applied
  elsewhere, the void flow surfaces that dependency and requires explicit
  handling (reverse the credit application first) rather than leaving an
  invoice's balance silently inconsistent.
- Fee structures, invoices, and the ledger are always scoped to one of
  the academic year's configured terms (Term 1/2/3 by default, doc 05
  §2) — this module has no opinion on how many terms exist or what
  they're named, it just bills against whatever Admin has set up.
- Discount approval workflow is enforced server-side, not just hidden in
  the UI — an Accountant's direct API call to bypass approval still gets
  rejected by the permission/service layer.
- All monetary math happens server-side in integer cents; the frontend
  never computes a balance it displays as authoritative.
- **Privacy**: Teachers have no access to fee data by default (doc 04).
  `system_settings.teacher_fee_status_visibility` (default `false`,
  doc 05 §1) is the explicit opt-in if a school wants teachers to see a
  simple "fees current / overdue" badge — never on by default.

## Reports

- Collection rate (collected vs billed) by term/class/category, with a
  Term 1 vs Term 2 vs Term 3 comparison view.
- Outstanding balances list (exportable CSV, sortable by amount/overdue
  days, filterable by term/class).
- Per-student Term Fee History export (the same Term 1/2/3 breakdown
  used on-screen, as a downloadable record).
- Credit-balance liability report: total unapplied/available credit
  across all students, so the school can see this as a standing
  liability, not just a per-student convenience.
- Discount/scholarship utilization.
- Daily/weekly cash-up report for Accountant reconciliation.

## Dependencies

- **Depends on**: Student Information (07) for `students`/`sections`;
  academic calendar (`academic_years`/`terms`) from doc 05.
- **Feeds**: Communication (10) for due-date reminders and overdue
  alerts; Student profile rollup (07).
