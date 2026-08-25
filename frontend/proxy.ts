import { NextResponse, type NextRequest } from "next/server";

// Intentionally a no-op pass-through (Next.js 16 renamed the "middleware"
// convention to "proxy" — same edge-runtime seam, new file name). Doc 02
// describes middleware reading a JWT from an httpOnly cookie to gate routes
// by role before render — but this app's access token lives in memory
// only (never a cookie, doc 14 XSS mitigation), so edge proxy code has no
// token to inspect. Real route protection happens client-side instead, via
// <AuthGuard> wrapping each role route group's layout
// (components/shared/auth-guard.tsx), which waits for AuthProvider's
// silent-refresh-on-load attempt before redirecting unauthenticated users
// to /login. This file is kept as the documented seam in case a future
// phase adds a lightweight httpOnly "is logged in" marker cookie that this
// could use for a faster redirect (not a token, just a boolean), at which
// point real edge-level gating could move here.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature required by the proxy file convention
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [],
};
