// Fixed, documented status → label/color mapping (doc 17: "a fixed,
// documented color-to-status mapping applied consistently across every
// module rather than each screen picking its own"). Mirrors the pattern in
// lib/display/student.ts. Shared by the staff directory and profile screens.

export const EMPLOYMENT_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  on_leave: "On leave",
  terminated: "Terminated",
};

export const EMPLOYMENT_STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  on_leave: "secondary",
  terminated: "destructive",
};

export const STAFF_ATTENDANCE_STATUS_LABELS: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  leave: "Leave",
  half_day: "Half day",
};

export const STAFF_ATTENDANCE_STATUS_BADGE_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  present: "default",
  absent: "destructive",
  leave: "secondary",
  half_day: "outline",
};
