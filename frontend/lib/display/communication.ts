import { Bell, CalendarDays, CircleDollarSign, GraduationCap, Megaphone, ShieldAlert, UserCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BadgeVariant } from "@/lib/display/examinations";

// Category display, defined once for the bell dropdown, the notification
// centre, the preferences screen, and the template editor (doc 17's
// consistent status/colour mapping rule).

export const CATEGORY_LABELS: Record<string, string> = {
  fees: "Fees",
  attendance: "Attendance",
  academics: "Academics",
  announcements: "Announcements",
  events: "Events",
  account: "Account",
  safety: "Safety",
};

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  fees: CircleDollarSign,
  attendance: CalendarDays,
  academics: GraduationCap,
  announcements: Megaphone,
  events: CalendarDays,
  account: UserCog,
  safety: ShieldAlert,
};

export function categoryIcon(category: string): LucideIcon {
  return CATEGORY_ICONS[category] ?? Bell;
}

/** Safety is the only category that carries visual urgency — everything
 * else is neutral, so a red badge always means "safety" and never just
 * "unread" (doc 15: colour is never the only signal, and never overused). */
export const CATEGORY_BADGE_VARIANT: Record<string, BadgeVariant> = {
  safety: "destructive",
};

export function categoryBadgeVariant(category: string): BadgeVariant {
  return CATEGORY_BADGE_VARIANT[category] ?? "secondary";
}

/** Why a given category's in-app toggle is fixed on. */
export const MANDATORY_CATEGORY_REASON: Record<string, string> = {
  fees: "Fee and payment notices can't be switched off in-app — overdue balances have to reach you.",
  safety: "Safety and emergency notices can't be switched off in-app.",
};

export const AUDIENCE_TYPE_LABELS: Record<string, string> = {
  school_wide: "School-wide",
  role: "By role",
  section: "One section",
  individual: "One person",
};

/** Email-leg delivery status on a notification row. In-app delivery is
 * immediate-by-existence, so this never describes whether the *in-app*
 * notification arrived — only the email that may have accompanied it. */
export const EMAIL_STATUS_LABELS: Record<string, string> = {
  not_requested: "In-app only",
  pending_digest: "Queued for daily digest",
  sent: "Emailed",
  failed: "Email failed",
};
