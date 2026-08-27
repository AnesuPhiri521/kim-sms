// Fixed, documented mappings for the Academic Performance module (doc 17:
// "a fixed, documented color-to-status mapping applied consistently across
// every module rather than each screen picking its own"). Shared by the
// gradebook, assessment list, performance dashboards, and reports.

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

// ------------------------------------------------------------- at risk --

export const AT_RISK_REASON_LABELS: Record<string, string> = {
  below_threshold: "Below threshold",
  sharp_drop: "Sharp drop",
};

export const AT_RISK_REASON_DESCRIPTIONS: Record<string, string> = {
  below_threshold:
    "Overall weighted average for this term is below the school's at-risk threshold (System Settings › academic_at_risk_threshold_pct).",
  sharp_drop: "Overall weighted average fell sharply compared with the previous term in the same academic year.",
};

export const AT_RISK_REASON_BADGE_VARIANT: Record<string, BadgeVariant> = {
  below_threshold: "destructive",
  sharp_drop: "secondary",
};

// -------------------------------------------------------- weight sums --

/**
 * Mirrors `WEIGHT_SUM_TOLERANCE_PCT` in
 * backend/app/services/academic_performance.py — the backend rejects a
 * create/update that would push a subject's term weights above
 * `100 + tolerance`, absorbing ordinary rounding (three assessments at
 * 33.33% each). The client uses the same tolerance so its indicator never
 * disagrees with what the server will accept.
 */
export const WEIGHT_SUM_TOLERANCE_PCT = 0.5;

export type WeightSumStatus = "complete" | "under" | "over";

export function weightSumStatus(total: number): WeightSumStatus {
  if (total > 100 + WEIGHT_SUM_TOLERANCE_PCT) return "over";
  if (total < 100 - WEIGHT_SUM_TOLERANCE_PCT) return "under";
  return "complete";
}

export const WEIGHT_SUM_BADGE_VARIANT: Record<WeightSumStatus, BadgeVariant> = {
  complete: "default",
  under: "secondary",
  over: "destructive",
};

export function weightSumMessage(total: number): string {
  const status = weightSumStatus(total);
  if (status === "over") {
    return `Weights total ${formatPct(total)} — over 100%. The server will reject any further assessment for this subject/term until weights are reduced.`;
  }
  if (status === "under") {
    return `Weights total ${formatPct(total)} — ${formatPct(100 - total)} still unallocated for this subject this term.`;
  }
  return `Weights total ${formatPct(total)} — fully allocated.`;
}

// ------------------------------------------------------------ scores --

/** One decimal place, trailing `%`; `—` for a missing value. */
export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/**
 * Performance banding used for the colour cue on averages across the
 * teacher/principal dashboards. Deliberately independent of the school's
 * configurable `grading_scales` (which drive the *letter grade* shown next
 * to the number) — this is only a consistent visual severity cue.
 */
export function averageBadgeVariant(average: number | null | undefined): BadgeVariant {
  if (average === null || average === undefined) return "outline";
  if (average < 50) return "destructive";
  if (average < 65) return "secondary";
  return "default";
}
