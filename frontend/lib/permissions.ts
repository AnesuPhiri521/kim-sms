import type { RoleCode } from "@/lib/roles";

/**
 * A **UI-affordance-only** mirror of the role→permission rows the backend
 * seeds from `backend/app/core/permissions.py` (`ROLE_PERMISSIONS`).
 *
 * This is not an authorization boundary and must never be treated as one —
 * the backend's `require_permission` dependencies are the real check, and
 * every screen still renders whatever 403 comes back as an inline error
 * state. What this buys is the difference between a Teacher seeing an
 * audience picker offering "School-wide" and then eating a 403 on submit,
 * versus the composer only ever offering the one scope they can actually
 * publish to (doc 17: don't present an action the user can't complete).
 *
 * The session's `UserSummary` carries `role_codes` but not permission
 * codes (see `backend/app/schemas/auth.py`), so roles are the only signal
 * available client-side — hence the mirror rather than a server-provided
 * permission list. Only the codes these screens actually branch on are
 * mirrored; a code absent from this map simply yields `false`, which
 * degrades to "hide the affordance", never to "allow it".
 */
const ROLE_PERMISSIONS: Record<RoleCode, readonly string[]> = {
  admin: [
    // Admin holds every seeded permission (`list(PERMISSIONS.keys())`).
    "announcements:publish",
    "events:manage",
    "notifications:configure",
    "notifications:send",
    "exams:manage",
    "exams:publish",
    "exam_marks:enter_own",
    "report_cards:compile",
    "report_cards:publish",
    "exam_results:view_own",
    "students:view",
    "academics_core:view",
    "grading_scales:manage",
    "attendance:edit_locked",
    "attendance:report",
    "attendance:mark",
    "attendance:edit",
  ],
  principal: [
    "announcements:publish",
    "events:manage",
    "exams:publish",
    "report_cards:publish",
    "students:view",
    "academics_core:view",
    "grading_scales:manage",
  ],
  registrar: ["notifications:send", "students:view", "academics_core:view", "attendance:report"],
  accountant: ["notifications:send", "academics_core:view"],
  teacher: [
    "announcements:publish_scoped",
    "events:manage",
    "exam_marks:enter_own",
    "report_cards:compile",
    "academics_core:view",
    "attendance:mark",
    "attendance:edit",
    "attendance:view_own",
  ],
  student: ["notifications:view_own", "exam_results:view_own", "attendance:view_own"],
  parent: ["notifications:view_own", "exam_results:view_own", "attendance:view_own"],
};

/** True if any of the caller's roles grants `code`. */
export function hasPermission(roleCodes: string[] | undefined, code: string): boolean {
  if (!roleCodes) return false;
  return roleCodes.some((role) => ROLE_PERMISSIONS[role as RoleCode]?.includes(code) ?? false);
}

/** True if any of the caller's roles grants at least one of `codes`. */
export function hasAnyPermission(roleCodes: string[] | undefined, ...codes: string[]): boolean {
  return codes.some((code) => hasPermission(roleCodes, code));
}
