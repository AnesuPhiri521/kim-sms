"use client";

import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { StudentAttendanceView } from "@/components/attendance/student-attendance-view";
import { useMyStudents } from "@/hooks/use-my-students";

/**
 * Student self-service landing page — `GET /students/me` resolves to
 * exactly one record for a Student login (never a switcher, unlike the
 * Parent dashboard which can have several children).
 */
export default function StudentDashboardPage() {
  const { data: students, isLoading, isError, error, refetch } = useMyStudents();
  const student = students?.[0];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Student Dashboard" description="Your overview." />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Student Dashboard" description="Your overview." />
        <ErrorState error={error} title="Couldn't load your record" onRetry={() => refetch()} />
      </div>
    );
  }

  if (!student) {
    return (
      <div className="space-y-6">
        <PageHeader title="Student Dashboard" description="Your overview." />
        <EmptyState
          title="No student record found"
          description="If this looks wrong, contact the school office to confirm your login is linked to your student record."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Student Dashboard" description={`${student.first_name} ${student.last_name}'s overview.`} />
      <StudentAttendanceView studentId={student.id} allowTermFilter />
    </div>
  );
}
