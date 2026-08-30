"use client";

import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAnnouncements } from "@/hooks/use-announcements";

/**
 * `GET /announcements` is already scoped server-side to what the caller's
 * audience should see (doc 10 security-review fix) — no client-side
 * filtering needed, so this one component works for every role.
 */
export function AnnouncementList() {
  const { data, isLoading, isError, error, refetch } = useAnnouncements();

  if (isLoading) return <CardSkeleton lines={4} />;
  if (isError) return <ErrorState error={error} title="Couldn't load announcements" onRetry={() => refetch()} />;
  const rows = data?.data ?? [];
  if (rows.length === 0) {
    return <EmptyState title="Nothing here yet" description="No announcements have been sent to you." />;
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <Card key={row.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{row.title}</CardTitle>
              {row.category === "safety" ? <Badge variant="destructive">Safety</Badge> : null}
              {row.expiry_date ? (
                <Badge variant="outline">Expires {new Date(row.expiry_date).toLocaleDateString()}</Badge>
              ) : null}
            </div>
            <CardDescription>{new Date(row.created_at).toLocaleString()}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{row.body}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
