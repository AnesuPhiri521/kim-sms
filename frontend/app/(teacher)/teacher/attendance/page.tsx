"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { TakeAttendancePanel } from "@/components/attendance/take-attendance-panel";
import { useAuth } from "@/lib/auth/auth-context";
import { useClasses } from "@/hooks/use-classes";
import { useMyAssignment } from "@/hooks/use-staff-assignments";
import { hasPermission } from "@/lib/permissions";

/**
 * Take-attendance screen (doc 09 UI screen 1) for the class-teacher's own
 * section — resolved the same way `app/(teacher)/teacher/page.tsx`'s "my
 * class" tab does, since there is no `/staff/me` endpoint either (see that
 * file's doc comment): the caller's current `staff_assignments` row is the
 * only source for "which section is mine".
 */
export default function TeacherAttendancePage() {
  const { user } = useAuth();
  const {
    data: myAssignment,
    isLoading: assignmentLoading,
    isError: assignmentError,
    error,
    refetch,
  } = useMyAssignment();
  const assignment = myAssignment?.data[0];
  const { data: classes } = useClasses();

  const sectionLabel = useMemo(() => {
    if (!assignment) return "My class";
    for (const c of classes ?? []) {
      const section = c.sections.find((s) => s.id === assignment.section_id);
      if (section) return `${c.name} - ${section.name}`;
    }
    return "My class";
  }, [classes, assignment]);

  const canOverrideLock = hasPermission(user?.role_codes, "attendance:edit_locked");

  if (assignmentLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Take attendance" description="Mark today's register for your class." />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  if (assignmentError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Take attendance" description="Mark today's register for your class." />
        <ErrorState error={error} title="Couldn't load your assignment" onRetry={() => refetch()} />
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="space-y-6">
        <PageHeader title="Take attendance" description="Mark today's register for your class." />
        <EmptyState
          title="No class assigned"
          description="You don't currently have a class assigned for this term. Contact an Admin if this looks wrong."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Take attendance" description={`Mark today's register for ${sectionLabel}.`} />
      <TakeAttendancePanel
        sectionId={assignment.section_id}
        sectionLabel={sectionLabel}
        canOverrideLock={canOverrideLock}
      />
    </div>
  );
}
