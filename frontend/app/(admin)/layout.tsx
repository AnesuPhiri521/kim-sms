"use client";

import { AuthGuard } from "@/components/shared/auth-guard";
import { AppShell, type NavItem } from "@/components/shared/app-shell";
import { LayoutDashboard, CalendarRange, Settings, School } from "lucide-react";
import { BACK_OFFICE_ROLES } from "@/lib/roles";

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Academic Years", href: "/academics/years", icon: CalendarRange },
  { label: "Classes", href: "/academics/classes", icon: School },
  { label: "Subjects", href: "/academics/subjects", icon: CalendarRange },
  { label: "School Settings", href: "/settings/school", icon: Settings },
  { label: "System Settings", href: "/settings/system", icon: Settings },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard allowedRoles={BACK_OFFICE_ROLES}>
      <AppShell navItems={navItems}>{children}</AppShell>
    </AuthGuard>
  );
}
