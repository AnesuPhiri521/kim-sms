import { CalendarRange, GraduationCap, ListChecks, School, Settings, TrendingUp } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const shortcuts = [
  {
    title: "Academic Years",
    description: "Manage years and terms",
    href: "/academics/years",
    icon: CalendarRange,
  },
  {
    title: "Classes & Sections",
    description: "Manage classes and their sections",
    href: "/academics/classes",
    icon: School,
  },
  {
    title: "System Settings",
    description: "Business-rule defaults by category",
    href: "/settings/system",
    icon: Settings,
  },
  // Academic Performance (doc 11) — these three screens have no sidebar
  // entry, so the dashboard is their only way in.
  {
    title: "Performance Reports",
    description: "At-risk watchlist and class/subject averages",
    href: "/academics/performance-reports",
    icon: TrendingUp,
  },
  {
    title: "Assessment Types",
    description: "Quiz, assignment, project… none are seeded by default",
    href: "/academics/assessment-types",
    icon: ListChecks,
  },
  {
    title: "Grading Scales",
    description: "Letter-grade bands used across coursework and exams",
    href: "/academics/grading-scales",
    icon: GraduationCap,
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="EduManage — Phase 0 foundation." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shortcuts.map((s) => (
          <Link key={s.href} href={s.href}>
            <Card className="hover:border-primary/50 transition-colors">
              <CardHeader>
                <s.icon className="text-primary size-5" />
                <CardTitle className="text-base">{s.title}</CardTitle>
                <CardDescription>{s.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
