"use client";

import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useExcuseRequests, useReviewExcuseRequest } from "@/hooks/use-attendance";
import { ApiError } from "@/lib/api/client";
import type { ExcuseRequest } from "@/lib/schemas/attendance";

/**
 * Teacher's excuse-request inbox (doc 09 feature 6). Scoped server-side to
 * the teacher's own currently-assigned section — `GET /excuse-requests`
 * didn't exist until this pass; there was no way to discover a pending
 * request except by already having its id from somewhere else.
 */
export default function ExcuseRequestsInboxPage() {
  const { data, isLoading, isError, error, refetch } = useExcuseRequests({ status: "pending" });
  const reviewMutation = useReviewExcuseRequest();

  async function review(row: ExcuseRequest, approve: boolean) {
    try {
      await reviewMutation.mutateAsync({ excuseId: row.id, approve });
      toast.success(approve ? "Excuse request approved" : "Excuse request rejected");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to review this request");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Excuse Requests"
        description="Pending leave/excuse notes for absences in your class, submitted by parents."
      />

      {isLoading ? (
        <CardSkeleton lines={4} />
      ) : isError ? (
        <ErrorState error={error} title="Couldn't load excuse requests" onRetry={() => refetch()} />
      ) : (data?.data ?? []).length === 0 ? (
        <EmptyState title="Nothing pending" description="No excuse requests are waiting for your review." />
      ) : (
        <div className="space-y-3">
          {(data?.data ?? []).map((row) => (
            <Card key={row.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="text-base">{row.reason}</CardTitle>
                  <CardDescription>
                    Requested {new Date(row.created_at).toLocaleDateString()}
                    {row.document_url ? (
                      <>
                        {" · "}
                        <a href={row.document_url} target="_blank" rel="noreferrer" className="underline">
                          View attached document
                        </a>
                      </>
                    ) : null}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => review(row, false)}
                    disabled={reviewMutation.isPending}
                  >
                    <X className="size-4" />
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => review(row, true)} disabled={reviewMutation.isPending}>
                    <Check className="size-4" />
                    Approve
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Badge variant="secondary">Pending</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
