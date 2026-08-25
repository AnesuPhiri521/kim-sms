"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import type { RoleCode } from "@/lib/roles";

// Route protection lives here, at the layout level, instead of in
// middleware.ts. Next.js middleware runs at the edge and can only read
// cookies — but the access token is deliberately kept in memory, never in
// a cookie (doc 14 XSS mitigation), so middleware has nothing to inspect.
// Instead, each role route group's layout wraps its children in this
// client-side guard, which waits for AuthProvider's silent-refresh attempt
// (POST /auth/refresh against the httpOnly cookie) to settle before
// deciding whether to redirect to /login. See middleware.ts for the same
// tradeoff noted at the edge layer.
export function AuthGuard({
  allowedRoles,
  children,
}: {
  allowedRoles?: RoleCode[];
  children: React.ReactNode;
}) {
  const { user, status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status !== "unauthenticated") return;
    router.replace("/login");
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated" || !user) return;
    if (allowedRoles && !user.role_codes.some((code) => allowedRoles.includes(code as RoleCode))) {
      router.replace("/login");
    }
  }, [status, user, allowedRoles, router]);

  if (status === "idle" || status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
      </div>
    );
  }

  if (status !== "authenticated" || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
