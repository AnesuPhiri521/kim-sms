// Fixed, documented status → label/color mapping (doc 17: "a fixed,
// documented color-to-status mapping applied consistently across every
// module rather than each screen picking its own"). Shared by the student
// list and profile screens.

export const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  withdrawn: "Withdrawn",
  transferred_out: "Transferred out",
  graduated: "Graduated",
};

export const ENROLLMENT_STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  withdrawn: "destructive",
  transferred_out: "secondary",
  graduated: "secondary",
};
