"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StudentPerformanceView } from "@/components/academic-performance/student-performance-view";
import { useMyStudents } from "@/hooks/use-my-students";

const DESCRIPTION = "Your child's coursework scores, updated as teachers enter them.";

/**
 * Parent-facing twin of app/(student)/student/performance/page.tsx —
 * same `StudentPerformanceView`, plus the per-child switcher, since
 * `GET /students/me` returns every actively-linked child for a Guardian
 * login. `(student)` and `(parent)` are separate Next.js route groups and
 * cannot share a URL, hence two thin pages over one shared component.
 */
export default function ParentPerformancePage() {
  const { data: students, isLoading, isError, error, refetch } = useMyStudents();
  const [pickedId, setPickedId] = useState<string | undefined>(undefined);
  // Falls back to the first child at render time rather than being copied
  // into state once the list loads.
  const selectedId = pickedId ?? students?.[0]?.id;
  const selected = students?.find((s) => s.id === selectedId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Performance" description={DESCRIPTION} />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Performance" description={DESCRIPTION} />
        <ErrorState error={error} title="Couldn't load your linked children" onRetry={() => refetch()} />
      </div>
    );
  }

  if (!students || students.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Performance" description={DESCRIPTION} />
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
        title="Performance"
        description={selected ? `${selected.first_name} ${selected.last_name}'s coursework scores.` : DESCRIPTION}
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
      {selectedId ? <StudentPerformanceView key={selectedId} studentId={selectedId} /> : null}
    </div>
  );
}
