"use client";

import { format } from "date-fns";
import { CalendarDays, MapPin } from "lucide-react";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEvents } from "@/hooks/use-events";
import type { Event } from "@/lib/schemas/communication";

function groupByMonth(events: Event[]): [string, Event[]][] {
  const groups = new Map<string, Event[]>();
  for (const event of events) {
    const key = format(new Date(event.event_date), "MMMM yyyy");
    const bucket = groups.get(key) ?? [];
    bucket.push(event);
    groups.set(key, bucket);
  }
  return Array.from(groups.entries());
}

/**
 * doc 10 UI screen 4 — a list view grouped by month rather than a grid
 * calendar widget (doc 03: no new UI/date-picker library beyond what's
 * already a dependency). `GET /events` is already scoped server-side to
 * what the caller's audience should see, same as announcements.
 */
export function EventCalendar() {
  const { data, isLoading, isError, error, refetch } = useEvents();

  if (isLoading) return <CardSkeleton lines={4} />;
  if (isError) return <ErrorState error={error} title="Couldn't load events" onRetry={() => refetch()} />;

  const events = [...(data?.data ?? [])].sort((a, b) => a.event_date.localeCompare(b.event_date));
  if (events.length === 0) {
    return <EmptyState title="Nothing scheduled" description="No upcoming events have been added yet." />;
  }

  return (
    <div className="space-y-6">
      {groupByMonth(events).map(([month, monthEvents]) => (
        <div key={month} className="space-y-3">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">{month}</h2>
          {monthEvents.map((event) => (
            <Card key={event.id}>
              <CardHeader className="flex flex-row items-start gap-3">
                <div className="bg-muted flex size-12 shrink-0 flex-col items-center justify-center rounded-md">
                  <CalendarDays className="text-muted-foreground size-5" />
                </div>
                <div>
                  <CardTitle className="text-base">{event.title}</CardTitle>
                  <p className="text-muted-foreground text-sm">
                    {format(new Date(event.event_date), "EEEE, d MMMM yyyy")}
                    {event.start_time ? ` · ${event.start_time}` : ""}
                    {event.end_time ? `–${event.end_time}` : ""}
                  </p>
                  {event.location ? (
                    <p className="text-muted-foreground flex items-center gap-1 text-sm">
                      <MapPin className="size-3.5" />
                      {event.location}
                    </p>
                  ) : null}
                </div>
              </CardHeader>
              {event.description ? (
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap">{event.description}</p>
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}
