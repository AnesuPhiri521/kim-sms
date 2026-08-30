"use client";

import { PageHeader } from "@/components/shared/page-header";
import { AnnouncementComposer } from "@/components/communication/announcement-composer";
import { AnnouncementList } from "@/components/communication/announcement-list";

export default function AdminAnnouncementsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        description="School-wide, role-targeted, or section-targeted broadcasts."
        actions={<AnnouncementComposer scope="unscoped" />}
      />
      <AnnouncementList />
    </div>
  );
}
