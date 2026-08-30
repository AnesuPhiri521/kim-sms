"use client";

import { AuthGuard } from "@/components/shared/auth-guard";
import { AppShell, type NavItem } from "@/components/shared/app-shell";
import { FileText, LayoutDashboard } from "lucide-react";

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/student", icon: LayoutDashboard },
  // doc 12 feature 7 — see `reportCardsPathForRoles` in lib/roles.ts for
  // why this URL is route-group-specific rather than shared.
  { label: "Report Cards", href: "/student/report-cards", icon: FileText },
];

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard allowedRoles={["student"]}>
      <AppShell navItems={navItems}>{children}</AppShell>
    </AuthGuard>
  );
}
