// Fixed, documented status → label/colour mapping for attendance (doc 17:
// "a fixed, documented color-to-status mapping applied consistently across
// every module rather than each screen picking its own", and "colour is
// never the only status signal" — hence the short code paired with every
// swatch on the calendar grid).
//
// Shared by the take-attendance chips, the month calendar, the section
// report, and the student-profile attendance tab.

import type { AttendanceStatus } from "@/lib/schemas/attendance";

export const ATTENDANCE_STATUS_LABELS: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  half_day: "Half day",
  excused: "Excused",
};

/** One-letter code shown inside a calendar cell so status never depends on colour alone. */
export const ATTENDANCE_STATUS_CODE: Record<string, string> = {
  present: "P",
  absent: "A",
  late: "L",
  half_day: "H",
  excused: "E",
};

/** Cell/chip surface classes, light + dark. */
export const ATTENDANCE_STATUS_CLASSES: Record<string, string> = {
  present: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  absent: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
  late: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  half_day: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  excused: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
};

/** Selected-state classes for the take-attendance ToggleGroup chips. */
export const ATTENDANCE_STATUS_TOGGLE_CLASSES: Record<string, string> = {
  present:
    "data-[state=on]:bg-emerald-600 data-[state=on]:text-white dark:data-[state=on]:bg-emerald-700",
  absent: "data-[state=on]:bg-rose-600 data-[state=on]:text-white dark:data-[state=on]:bg-rose-700",
  late: "data-[state=on]:bg-amber-600 data-[state=on]:text-white dark:data-[state=on]:bg-amber-700",
  half_day: "data-[state=on]:bg-sky-600 data-[state=on]:text-white dark:data-[state=on]:bg-sky-700",
  excused:
    "data-[state=on]:bg-violet-600 data-[state=on]:text-white dark:data-[state=on]:bg-violet-700",
};

export const ATTENDANCE_STATUS_BADGE_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  present: "default",
  absent: "destructive",
  late: "secondary",
  half_day: "secondary",
  excused: "outline",
};

export function attendanceStatusLabel(status: string): string {
  return ATTENDANCE_STATUS_LABELS[status] ?? status;
}

/** Order the chips/legend are always rendered in — least to most severe left-to-right. */
export const ATTENDANCE_STATUS_ORDER: AttendanceStatus[] = [
  "present",
  "late",
  "half_day",
  "excused",
  "absent",
];

/** Attendance-rate → tone, used by the report/watchlist tables. */
export function attendanceRateTone(ratePct: number): string {
  if (ratePct >= 90) return "text-emerald-700 dark:text-emerald-400";
  if (ratePct >= 75) return "text-amber-700 dark:text-amber-400";
  return "text-rose-700 dark:text-rose-400";
}
