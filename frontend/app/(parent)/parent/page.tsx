import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";

// Parent self-service (attendance, grades, fee balance/payment — docs 08/09/12)
// isn't built yet in Phase 0; this is the landing shell so the (parent)
// route group and its layout/nav exist and login routes correctly by role.
export default function ParentDashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Parent Dashboard" description="Your child's overview." />
      <EmptyState title="Nothing here yet" description="Attendance, grades, and fee balance arrive in a later phase." />
    </div>
  );
}
