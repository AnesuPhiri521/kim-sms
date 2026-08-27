"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from "@/hooks/use-notifications";
import { CATEGORY_LABELS, categoryBadgeVariant, categoryIcon } from "@/lib/display/communication";
import { cn } from "@/lib/utils";

const READ_FILTERS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
] as const;

/**
 * doc 10 UI screen 2 — the full list behind the header bell's "View all",
 * shared across every role's route group (a plain component rather than
 * one page, since Next's route groups can't share a URL across layouts —
 * see the thin per-group `page.tsx` wrappers that render this).
 */
export function NotificationCenter() {
  const [category, setCategory] = useState<string>("all");
  const [readFilter, setReadFilter] = useState<(typeof READ_FILTERS)[number]["value"]>("all");

  const { data, isLoading, isError, error, refetch } = useNotifications({
    category: category === "all" ? undefined : category,
    read: readFilter === "all" ? undefined : readFilter === "read",
    pageSize: 50,
  });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const rows = data?.data ?? [];
  const hasUnread = rows.some((row) => !row.read_at);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Everything sent to you, most recent first."
        actions={
          hasUnread ? (
            <Button variant="outline" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
              Mark all read
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-3">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={readFilter} onValueChange={(value) => setReadFilter(value as typeof readFilter)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {READ_FILTERS.map((filter) => (
              <SelectItem key={filter.value} value={filter.value}>
                {filter.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <CardSkeleton lines={6} />
      ) : isError ? (
        <ErrorState error={error} title="Couldn't load notifications" onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing here" description="No notifications match this filter yet." />
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {rows.map((notification) => {
              const Icon = categoryIcon(notification.category);
              return (
                <div
                  key={notification.id}
                  className={cn("flex items-start gap-3 p-4", !notification.read_at && "bg-muted/40")}
                >
                  <Icon className="text-muted-foreground mt-0.5 size-5 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{notification.title}</p>
                      <Badge variant={categoryBadgeVariant(notification.category)}>
                        {CATEGORY_LABELS[notification.category] ?? notification.category}
                      </Badge>
                      {!notification.read_at ? <Badge variant="secondary">Unread</Badge> : null}
                    </div>
                    <p className="text-muted-foreground text-sm">{notification.body}</p>
                    <p className="text-muted-foreground text-xs">
                      {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  {!notification.read_at ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markRead.mutate(notification.id)}
                      disabled={markRead.isPending}
                    >
                      Mark read
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
