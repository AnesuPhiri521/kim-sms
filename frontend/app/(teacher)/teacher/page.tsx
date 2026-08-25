import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";

// Teacher-facing modules (attendance, gradebook, exam marks — docs 09/11/12)
// aren't built yet in Phase 0; this is the landing shell so the (teacher)
// route group and its layout/nav exist and login routes correctly by role.
export default function TeacherDashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Teacher Dashboard" description="Your class overview." />
      <EmptyState title="Nothing here yet" description="Attendance, gradebook, and class tools arrive in a later phase." />
    </div>
  );
}
