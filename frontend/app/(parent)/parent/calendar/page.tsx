"use client";

import { PageHeader } from "@/components/shared/page-header";
import { EventCalendar } from "@/components/communication/event-calendar";

export default function ParentCalendarPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="School Calendar" description="Exams, holidays, meetings, sports day." />
      <EventCalendar />
    </div>
  );
}
