import type { ReportCardStatus } from "@/lib/schemas/examinations";

// Fixed status→label/colour mappings, defined once and reused across every
// Examinations screen (doc 17: "a documented colour-to-status mapping
// applied consistently across every module rather than each screen picking
// its own"). Same shape as lib/display/student.ts.

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export const EXAM_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  ongoing: "Ongoing",
  completed: "Completed",
  published: "Published",
};

export const EXAM_STATUS_BADGE_VARIANT: Record<string, BadgeVariant> = {
  scheduled: "outline",
  ongoing: "secondary",
  completed: "secondary",
  published: "default",
};

export const REPORT_CARD_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  published: "Published",
};

export const REPORT_CARD_STATUS_BADGE_VARIANT: Record<string, BadgeVariant> = {
  draft: "outline",
  reviewed: "secondary",
  published: "default",
};

export const EXAM_TYPE_LABELS: Record<string, string> = {
  summative: "Summative",
  formative: "Formative",
};

/** Short plain-language description of what each report-card status means
 * for the person looking at it — used in list captions and empty states. */
export const REPORT_CARD_STATUS_HINTS: Record<ReportCardStatus, string> = {
  draft: "Compiled by the class teacher, not yet reviewed.",
  reviewed: "Signed off by a reviewer, waiting to be published to the cohort.",
  published: "Released to students and guardians. Locked against further edits.",
};

export function formatScore(score: number | null, maxScore: number | null | undefined): string {
  if (score === null) return "—";
  if (maxScore === null || maxScore === undefined) return String(score);
  return `${score}/${maxScore}`;
}

/** "14:30:00" -> "14:30". Times arrive from the API as HH:MM:SS. */
export function formatTime(time: string | null): string {
  if (!time) return "—";
  return time.slice(0, 5);
}
