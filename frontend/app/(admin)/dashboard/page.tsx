import { CalendarRange, School, Settings } from "lucide-react";
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
