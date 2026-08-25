"use client";

import { AuthGuard } from "@/components/shared/auth-guard";
import { AppShell, type NavItem } from "@/components/shared/app-shell";
import { LayoutDashboard } from "lucide-react";

const navItems: NavItem[] = [{ label: "Dashboard", href: "/student", icon: LayoutDashboard }];

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard allowedRoles={["student"]}>
      <AppShell navItems={navItems}>{children}</AppShell>
    </AuthGuard>
  );
}
