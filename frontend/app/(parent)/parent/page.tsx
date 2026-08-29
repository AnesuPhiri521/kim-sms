"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { CardSkeleton } from "@/components/shared/card-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { FeeBalanceCard } from "@/components/fees/fee-balance-card";
import { TermFeeHistory } from "@/components/fees/term-fee-history";
import { PaymentHistory } from "@/components/fees/payment-history";
import { StudentAttendanceView } from "@/components/attendance/student-attendance-view";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMyStudents } from "@/hooks/use-my-students";
import { useStudentFeeBalance } from "@/hooks/use-fees";
import { useCurrencyCode } from "@/hooks/use-currency";

/**
 * Parent self-service landing page (docs 07/08/09/12 all converge here
 * eventually — this pass covers the Fees half). `useMyStudents` resolves
 * every actively-linked child via `GET /students/me`; the switcher below
 * only appears once there's more than one.
 */
export default function ParentDashboardPage() {
  const { data: students, isLoading, isError, error, refetch } = useMyStudents();
  const [pickedId, setPickedId] = useState<string | undefined>(undefined);
  // Defaults to the first child once the list resolves, without ever
  // needing to copy that into state via an effect — a real pick always
  // wins over the fallback.
  const selectedId = pickedId ?? students?.[0]?.id;

  const selected = students?.find((s) => s.id === selectedId);
  const balanceQuery = useStudentFeeBalance(selectedId);
  const currencyCode = useCurrencyCode(balanceQuery.data?.currency_code);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Parent Dashboard" description="Your child's overview." />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Parent Dashboard" description="Your child's overview." />
        <ErrorState error={error} title="Couldn't load your linked children" onRetry={() => refetch()} />
      </div>
    );
  }

  if (!students || students.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Parent Dashboard" description="Your child's overview." />
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
        title="Parent Dashboard"
        description={selected ? `${selected.first_name} ${selected.last_name}'s account.` : "Your child's overview."}
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

      {selectedId ? (
        <Tabs defaultValue="fees">
          <TabsList>
            <TabsTrigger value="fees">Fees</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
          </TabsList>
          <TabsContent value="fees" className="mt-4 space-y-6">
            <FeeBalanceCard
              balance={balanceQuery.data}
              isLoading={balanceQuery.isLoading}
              isError={balanceQuery.isError}
              error={balanceQuery.error}
              onRetry={() => balanceQuery.refetch()}
              spacious
            />
            <TermFeeHistory studentId={selectedId} currencyCode={currencyCode} />
            <PaymentHistory studentId={selectedId} currencyCode={currencyCode} readOnly />
          </TabsContent>
          <TabsContent value="attendance" className="mt-4">
            <StudentAttendanceView studentId={selectedId} allowTermFilter />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}
