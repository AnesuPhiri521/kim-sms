"use client";

import { PageHeader } from "@/components/shared/page-header";
import { EventComposer } from "@/components/communication/event-composer";
import { EventCalendar } from "@/components/communication/event-calendar";

export default function TeacherCalendarPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="School Calendar"
        description="Exams, holidays, meetings, sports day."
        actions={<EventComposer />}
      />
      <EventCalendar />
    </div>
  );
}
