"use client";

import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { StudentPerformanceView } from "@/components/academic-performance/student-performance-view";
import { useMyStudents } from "@/hooks/use-my-students";

const DESCRIPTION = "Your coursework scores, subject by subject.";

/**
 * Student self-service performance page (doc 11 feature 6). `GET
 * /students/me` resolves to exactly one record for a Student login, so
 * there is no child switcher here — that's the Parent variant at
 * app/(parent)/parent/performance/page.tsx, which renders the same
 * `StudentPerformanceView`. The two can't share a URL: `(student)` and
 * `(parent)` are separate route groups.
 */
export default function StudentPerformancePage() {
  const { data: students, isLoading, isError, error, refetch } = useMyStudents();
  const student = students?.[0];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Performance" description={DESCRIPTION} />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Performance" description={DESCRIPTION} />
        <ErrorState error={error} title="Couldn't load your record" onRetry={() => refetch()} />
      </div>
    );
  }

  if (!student) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Performance" description={DESCRIPTION} />
        <EmptyState
          title="No student record found"
          description="If this looks wrong, contact the school office to confirm your login is linked to your student record."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="My Performance" description={DESCRIPTION} />
      <StudentPerformanceView studentId={student.id} />
    </div>
  );
}
