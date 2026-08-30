"use client";

import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { StudentReportCardsView } from "@/components/examinations/student-report-cards-view";
import { useMyStudents } from "@/hooks/use-my-students";

const DESCRIPTION = "Your published report cards and exam results, including past terms.";

/**
 * Thin per-route-group page over the one shared
 * `StudentReportCardsView` — the same arrangement as the notification
 * centre (see `notificationsPathForRoles` in lib/roles.ts): route groups
 * can't share a URL, so `/student/report-cards` and
 * `/parent/report-cards` are separate routes rendering identical content.
 *
 * `GET /students/me` resolves to exactly one record for a Student login,
 * so there's no child switcher here (unlike the Parent page).
 */
export default function StudentReportCardsPage() {
  const { data: students, isLoading, isError, error, refetch } = useMyStudents();
  const student = students?.[0];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Report Cards" description={DESCRIPTION} />
        <CardSkeleton lines={5} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Report Cards" description={DESCRIPTION} />
        <ErrorState error={error} title="Couldn't load your record" onRetry={() => refetch()} />
      </div>
    );
  }

  if (!student) {
    return (
      <div className="space-y-6">
        <PageHeader title="Report Cards" description={DESCRIPTION} />
        <EmptyState
          title="No student record found"
          description="If this looks wrong, contact the school office to confirm your login is linked to your student record."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Report Cards" description={DESCRIPTION} />
      <StudentReportCardsView
        studentId={student.id}
        studentName={`${student.first_name} ${student.last_name}`}
      />
    </div>
  );
}
