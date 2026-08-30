"use client";

import { PageHeader } from "@/components/shared/page-header";
import { NotificationPreferencesForm } from "@/components/communication/notification-preferences-form";

export default function AdminNotificationPreferencesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Notification Preferences" description="Choose how you're notified, per category." />
      <NotificationPreferencesForm />
    </div>
  );
}
