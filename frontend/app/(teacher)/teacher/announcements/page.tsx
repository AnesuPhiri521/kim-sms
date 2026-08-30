"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { AnnouncementComposer } from "@/components/communication/announcement-composer";
import { AnnouncementList } from "@/components/communication/announcement-list";
import { useClasses } from "@/hooks/use-classes";
import { useMyAssignment } from "@/hooks/use-staff-assignments";

/**
 * A Teacher (`announcements:publish_scoped`) may only ever target their
 * own currently-assigned section — resolved the same way
 * `app/(teacher)/teacher/page.tsx`'s "my class" tab does, since there's
 * no `/staff/me` endpoint either.
 */
export default function TeacherAnnouncementsPage() {
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
    if (!assignment) return null;
    for (const c of classes ?? []) {
      const section = c.sections.find((s) => s.id === assignment.section_id);
      if (section) return `${c.name} - ${section.name}`;
    }
    return null;
  }, [classes, assignment]);

  if (assignmentLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Announcements" description="Broadcast to your class's parents and students." />
        <CardSkeleton lines={4} />
      </div>
    );
  }

  if (assignmentError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Announcements" description="Broadcast to your class's parents and students." />
        <ErrorState error={error} title="Couldn't load your assignment" onRetry={() => refetch()} />
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="space-y-6">
        <PageHeader title="Announcements" description="Broadcast to your class's parents and students." />
        <EmptyState
          title="No class assigned"
          description="You need a current class assignment before you can send an announcement. Contact an Admin if this looks wrong."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        description={`Broadcast to ${sectionLabel ?? "your class"}'s parents and students.`}
        actions={
          <AnnouncementComposer
            scope="scoped"
            sectionId={assignment.section_id}
            sectionLabel={sectionLabel ?? "your class"}
          />
        }
      />
      <AnnouncementList />
    </div>
  );
}
