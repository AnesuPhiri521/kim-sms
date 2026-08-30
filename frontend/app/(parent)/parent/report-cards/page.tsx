"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { StudentReportCardsView } from "@/components/examinations/student-report-cards-view";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMyStudents } from "@/hooks/use-my-students";

const DESCRIPTION = "Published report cards and exam results for your children, including past terms.";

/**
 * Parent half of doc 12 feature 7 — the same shared
 * `StudentReportCardsView` the Student route group renders, behind the
 * per-child switcher already used on the Parent dashboard: the picked id
 * falls back to the first child *at render time*, never copied into state
 * from an effect.
 */
export default function ParentReportCardsPage() {
  const { data: students, isLoading, isError, error, refetch } = useMyStudents();
  const [pickedId, setPickedId] = useState<string | undefined>(undefined);
  const selectedId = pickedId ?? students?.[0]?.id;
  const selected = students?.find((s) => s.id === selectedId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Report Cards" description={DESCRIPTION} />
        <CardSkeleton lines={5} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Report Cards" description={DESCRIPTION} />
        <ErrorState error={error} title="Couldn't load your linked children" onRetry={() => refetch()} />
      </div>
    );
  }

  if (!students || students.length === 0 || !selectedId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Report Cards" description={DESCRIPTION} />
        <EmptyState
          title="No linked children found"
          description="If this looks wrong, contact the school office to confirm you're linked as a guardian."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Report Cards"
        description={
          selected ? `${selected.first_name} ${selected.last_name}'s results.` : DESCRIPTION
        }
        actions={
          students.length > 1 ? (
            <Select value={selectedId} onValueChange={setPickedId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Choose a child" />
              </SelectTrigger>
              <SelectContent>
                {students.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.first_name} {s.last_name} · {s.admission_no}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
      />
      <StudentReportCardsView
        studentId={selectedId}
        studentName={selected ? `${selected.first_name} ${selected.last_name}` : undefined}
      />
    </div>
  );
}
