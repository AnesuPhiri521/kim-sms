import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";

// Student self-service (timetable, attendance, grades — docs 09/12) isn't
// built yet in Phase 0; this is the landing shell so the (student) route
// group and its layout/nav exist and login routes correctly by role.
export default function StudentDashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Student Dashboard" description="Your overview." />
      <EmptyState title="Nothing here yet" description="Timetable, attendance, and grades arrive in a later phase." />
    </div>
  );
}
