"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useUnreadNotifications,
} from "@/hooks/use-notifications";
import { useAuth } from "@/lib/auth/auth-context";
import { notificationPreferencesPathForRoles, notificationsPathForRoles } from "@/lib/roles";
import type { Notification } from "@/lib/schemas/communication";
import { cn } from "@/lib/utils";

/**
 * Header bell for every role layout (doc 10 UI screen 1). Shows the most
 * recent unread notifications; clicking one marks it read (the row itself
 * carries no navigable link target beyond `related_entity_type`/`_id`,
 * which isn't resolved to a route here — that's the notification center
 * page's job, not the dropdown's).
 */
export function NotificationBell() {
  const { user } = useAuth();
  const { data, isLoading } = useUnreadNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const notificationsPath = notificationsPathForRoles(user?.role_codes ?? []);
  const preferencesPath = notificationPreferencesPathForRoles(user?.role_codes ?? []);

  const unreadCount = data?.meta.total ?? 0;
  const rows = data?.data ?? [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`} className="relative">
          <Bell className="size-5" />
          {unreadCount > 0 ? (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] tabular-nums"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between p-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unreadCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              Mark all read
            </Button>
          ) : null}
        </div>
        <Separator />
        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <p className="text-muted-foreground p-4 text-center text-sm">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">You&apos;re all caught up.</p>
          ) : (
            rows.map((notification: Notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => markRead.mutate(notification.id)}
                className={cn(
                  "hover:bg-muted w-full space-y-0.5 border-b p-3 text-left text-sm last:border-b-0",
                  !notification.read_at && "bg-muted/40"
                )}
              >
                <p className="font-medium">{notification.title}</p>
                <p className="text-muted-foreground line-clamp-2">{notification.body}</p>
                <p className="text-muted-foreground text-xs">
                  {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                </p>
              </button>
            ))
          )}
        </div>
        <Separator />
        <div className="flex gap-2 p-2">
          <Button asChild variant="ghost" size="sm" className="flex-1">
            <Link href={notificationsPath}>View all</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="flex-1">
            <Link href={preferencesPath}>Preferences</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
