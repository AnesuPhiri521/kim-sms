"use client";

import { AuthGuard } from "@/components/shared/auth-guard";
import { AppShell, type NavItem } from "@/components/shared/app-shell";
import { LayoutDashboard } from "lucide-react";

const navItems: NavItem[] = [{ label: "Dashboard", href: "/teacher", icon: LayoutDashboard }];

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard allowedRoles={["teacher"]}>
      <AppShell navItems={navItems}>{children}</AppShell>
    </AuthGuard>
  );
}
