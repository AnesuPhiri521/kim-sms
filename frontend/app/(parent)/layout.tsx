"use client";

import { AuthGuard } from "@/components/shared/auth-guard";
import { AppShell, type NavItem } from "@/components/shared/app-shell";
import { LayoutDashboard } from "lucide-react";

const navItems: NavItem[] = [{ label: "Dashboard", href: "/parent", icon: LayoutDashboard }];

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard allowedRoles={["parent"]}>
      <AppShell navItems={navItems}>{children}</AppShell>
    </AuthGuard>
  );
}
