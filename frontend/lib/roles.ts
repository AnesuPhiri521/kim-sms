// Role codes as returned in LoginResponse.user.role_codes (doc 04).
export type RoleCode = "admin" | "principal" | "registrar" | "accountant" | "teacher" | "student" | "parent";

// Phase 0 only has screens built for the back-office roles (doc 04's
// Admin/Principal/Registrar/Accountant), sharing the (admin) route group's
// dense layout (doc 17 density guidance). The backend's `require_permission`
// dependencies are the real authorization boundary — this list only decides
// which shared layout/nav a role lands in; a Registrar hitting a
// system-settings screen still gets a 403 from the API, surfaced as an
// inline error state.
export const BACK_OFFICE_ROLES: RoleCode[] = ["admin", "principal", "registrar", "accountant"];

export function isBackOfficeRole(roleCodes: string[]): boolean {
  return roleCodes.some((code) => BACK_OFFICE_ROLES.includes(code as RoleCode));
}

/** Where a freshly authenticated user should land, based on their roles. */
export function homePathForRoles(roleCodes: string[]): string {
  if (isBackOfficeRole(roleCodes)) return "/dashboard";
  if (roleCodes.includes("teacher")) return "/teacher";
  if (roleCodes.includes("parent")) return "/parent";
  if (roleCodes.includes("student")) return "/student";
  return "/login";
}
