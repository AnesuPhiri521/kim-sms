"use client";

import { AuthGuard } from "@/components/shared/auth-guard";
import { AppShell, type NavItem } from "@/components/shared/app-shell";
import {
  LayoutDashboard,
  CalendarRange,
  Settings,
  School,
  Users,
  UserCog,
  ClipboardList,
  CircleDollarSign,
  ClipboardCheck,
  AlertTriangle,
  Megaphone,
  CalendarDays,
  GraduationCap,
  FileText,
} from "lucide-react";
import { BACK_OFFICE_ROLES } from "@/lib/roles";

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Students", href: "/students", icon: Users },
  {
    label: "Staff",
    icon: UserCog,
    items: [
      { label: "Staff", href: "/staff", icon: UserCog },
      { label: "Assignments", href: "/staff/assignments", icon: ClipboardList },
    ],
  },
  {
    label: "Fees",
    icon: CircleDollarSign,
    items: [
      { label: "Fee Structures", href: "/fees/structures", icon: CircleDollarSign },
      { label: "Outstanding Balances", href: "/fees/invoices", icon: CircleDollarSign },
      { label: "Fee Reports", href: "/fees/reports", icon: CircleDollarSign },
    ],
  },
  {
    label: "Attendance",
    icon: ClipboardCheck,
    items: [
      { label: "Attendance Report", href: "/attendance/reports/section", icon: ClipboardCheck },
      { label: "Absenteeism Watchlist", href: "/attendance/watchlist", icon: AlertTriangle },
    ],
  },
  {
    label: "Academics",
    icon: School,
    items: [
      { label: "Academic Years", href: "/academics/years", icon: CalendarRange },
      { label: "Classes", href: "/academics/classes", icon: School },
      { label: "Subjects", href: "/academics/subjects", icon: CalendarRange },
    ],
  },
  {
    label: "Examinations",
    icon: GraduationCap,
    items: [
      { label: "Exams", href: "/exams", icon: GraduationCap },
      { label: "Report Cards", href: "/report-cards", icon: FileText },
    ],
  },
  {
    label: "Communication",
    icon: Megaphone,
    items: [
      { label: "Announcements", href: "/announcements", icon: Megaphone },
      { label: "Calendar", href: "/calendar", icon: CalendarDays },
    ],
  },
  {
    label: "Settings",
    icon: Settings,
    items: [
      { label: "School Settings", href: "/settings/school", icon: Settings },
      { label: "System Settings", href: "/settings/system", icon: Settings },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard allowedRoles={BACK_OFFICE_ROLES}>
      <AppShell navItems={navItems}>{children}</AppShell>
    </AuthGuard>
  );
}
