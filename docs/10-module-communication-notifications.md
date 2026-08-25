# 10 — Module: Communication & Notifications

> **Objective:** Establish a centralized communication platform that
> enables administrators, teachers, students, and parents/guardians to
> receive timely notifications regarding fees, attendance, academic
> performance, announcements, events, and other important school
> information.

This module is largely **cross-cutting** — it's the delivery mechanism
other modules call into (fee reminders from doc 08, absenteeism alerts
from doc 09, grade/result publication from docs 11–12), plus its own
first-class features (announcements, events, direct messaging).

## Key entities

`notification_templates`, `notifications`, `announcements`, `events`,
`notification_preferences` (doc 05, section 7).

## Roles & permissions

| Action | Role(s) |
|---|---|
| Publish school-wide announcement | Admin, Principal |
| Publish class announcement | Teacher (own class) |
| Create an event | Admin, Principal, Teacher |
| Send targeted communication (e.g. to one guardian) | Admin, Registrar, Accountant (fee-related), Teacher (own class) |
| Configure notification templates/channels | Admin |
| Receive/read notifications | All roles (own notifications) |
| Set own notification preferences | All roles (subject to mandatory categories) |

Codes: `announcements:publish`, `announcements:publish_scoped`,
`events:manage`, `notifications:send`, `notifications:configure`,
`notifications:view_own`.

## Core features / user stories

1. **In-app notification center**: bell icon + list, unread badge, mark
   read/unread, filter by category (fees/attendance/academics/
   announcements/events) — available to every role.
2. **Announcements**: Admin/Principal broadcast school-wide; a Teacher
   broadcasts to their own class only. Audience targeting by role,
   section, or individual. Optional expiry date.
3. **Events**: calendar entries (exams, holidays, parent-teacher meetings,
   sports day) with the same audience targeting; surfaces on a shared
   school calendar view.
4. **Automated triggers from other modules** (via the shared notification
   service, doc 02):
   - Fee: invoice generated, payment received (receipt), due-date
     reminder (N days before), overdue alert.
   - Attendance: absenteeism flag raised, excuse-request approved/
     rejected.
   - Academics: new grade/assessment score posted, exam result
     published, report card published.
   - Staff/Admin: new account invite, role change, password reset.
5. **Channel routing**: notifications go out on exactly two channels —
   **in-app** (always) and **email** (if the user's preferences allow it
   for that category). This is the school's chosen channel set; there is
   no SMS channel in this system.
6. **Digest mode**: users can opt into a daily digest email instead of
   per-event emails, to avoid notification fatigue for high-frequency
   categories like attendance.
7. **Delivery tracking**: `notifications.status` tracks queued → sent →
   (read, for in-app); failed sends are retried with backoff by the
   background job and surfaced to Admin if persistently failing (e.g.
   bad SMTP config).

## API surface (high level)

```
GET    /api/v1/notifications                         current user's, paginated, filterable by category/read-state
PATCH  /api/v1/notifications/{id}/read
POST   /api/v1/notifications/mark-all-read

GET/POST /api/v1/announcements
PATCH    /api/v1/announcements/{id}
GET/POST /api/v1/events
PATCH    /api/v1/events/{id}

GET    /api/v1/notification-preferences               current user's
PATCH  /api/v1/notification-preferences

GET/POST/PATCH /api/v1/notification-templates          admin-only, template content per category/channel
```

Internal (not exposed as a public route, called by services):
`NotificationService.send(user_id, template_code, context, category)` —
the single choke point every module routes through, so channel routing/
preferences/audit are enforced in one place rather than reimplemented per
module.

## UI screens

- **Notification bell + dropdown** (shadcn `Popover`/`DropdownMenu`) in
  the global app header, present on every role's layout.
- **Notification center page**: full list, filters, mark read.
- **Announcements composer** (Admin/Teacher): shadcn `Form` with audience
  picker, rich-text-lite body (or plain text v1), schedule/expiry.
- **School calendar**: month/list view of events (shadcn `Calendar`
  composed with a list panel).
- **Admin: notification settings**: template editor, channel
  enable/disable per category (in-app/email).
- **User: notification preferences**: per-category channel toggles.

## Business rules & edge cases

- Certain categories (fee overdue, safety/emergency announcements) are
  **mandatory** — a user cannot disable the in-app notification for these,
  only choose whether they *also* get it by email.
- Announcement audience targeting is enforced server-side against the
  same data-scoping rules as doc 04 (a Teacher cannot target a class
  they're not assigned to).
- Failed email sends never block the in-app notification from being
  created — in-app is always the reliable baseline; email delivery
  failures are retried with backoff and surfaced to Admin if persistently
  failing (e.g. bad SMTP config).

## Reports

- Notification delivery/read-rate by category (are fee reminders actually
  being seen?).
- Announcement reach (sent vs read).

## Dependencies

- **Depends on**: Identity & Access for recipients/roles; every other
  module as a *trigger source* (Fees 08, Attendance 09, Academics 11,
  Examinations 12).
- **Depended on by**: all modules, as the shared delivery mechanism.
