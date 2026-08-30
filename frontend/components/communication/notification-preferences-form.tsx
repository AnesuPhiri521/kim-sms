"use client";

import { toast } from "sonner";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { ErrorState } from "@/components/shared/error-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/hooks/use-notification-preferences";
import { ApiError } from "@/lib/api/client";
import { CATEGORY_LABELS } from "@/lib/display/communication";
import type { NotificationPreference } from "@/lib/schemas/communication";

/**
 * doc 10 UI screen 6 — per-category in-app/email/digest toggles. A
 * mandatory category's (`fees`, `safety`) in-app toggle is disabled
 * outright rather than allowed-then-rejected: `is_mandatory` comes
 * straight from the server (doc 10: the backend re-enforces this
 * regardless of what the UI shows, so trusting its own flag here is
 * safe — it can never drift into showing an editable toggle the API
 * would then 409 on).
 */
export function NotificationPreferencesForm() {
  const { data, isLoading, isError, error, refetch } = useNotificationPreferences();
  const updateMutation = useUpdateNotificationPreferences();

  async function update(row: NotificationPreference, changes: Partial<NotificationPreference>) {
    try {
      await updateMutation.mutateAsync([{ category: row.category, ...changes }]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update preference");
    }
  }

  if (isLoading) return <CardSkeleton lines={5} />;
  if (isError) {
    return <ErrorState error={error} title="Couldn't load your notification preferences" onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-3">
      {(data ?? []).map((row) => (
        <Card key={row.category}>
          <CardHeader>
            <CardTitle className="text-base">{CATEGORY_LABELS[row.category] ?? row.category}</CardTitle>
            {row.is_mandatory ? (
              <CardDescription>
                Mandatory — you can&apos;t turn off in-app notifications for this category, only email.
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={row.in_app_enabled}
                disabled={row.is_mandatory || updateMutation.isPending}
                onCheckedChange={(checked) => update(row, { in_app_enabled: checked })}
              />
              In-app
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={row.email_enabled}
                disabled={updateMutation.isPending}
                onCheckedChange={(checked) => update(row, { email_enabled: checked })}
              />
              Email
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={row.digest_mode}
                disabled={!row.email_enabled || updateMutation.isPending}
                onCheckedChange={(checked) => update(row, { digest_mode: checked })}
              />
              Daily digest instead of per-event email
            </label>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
