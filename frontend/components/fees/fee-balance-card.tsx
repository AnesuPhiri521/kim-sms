"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { ErrorState } from "@/components/shared/error-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/money";
import type { FeeBalance } from "@/lib/schemas/fee-financial";

type FeeBalanceCardProps = {
  balance: FeeBalance | undefined;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Parent/student screens get the roomier treatment (doc 17 density guidance). */
  spacious?: boolean;
  actions?: React.ReactNode;
};

/**
 * The student's live balance and available credit, straight from
 * `GET /students/{id}/fee-balance`. Both figures are server-derived from the
 * append-only ledger; this component never adds anything up itself.
 *
 * They're shown as two distinct numbers on purpose (doc 08: "'balance owed'
 * and 'credit available' read as two distinct, non-confusing numbers") —
 * credit is not netted off the balance.
 */
export function FeeBalanceCard({
  balance,
  isLoading,
  isError,
  error,
  onRetry,
  spacious = false,
  actions,
}: FeeBalanceCardProps) {
  if (isError) {
    return <ErrorState error={error} title="Couldn't load the fee balance" onRetry={onRetry} />;
  }

  const owes = (balance?.balance_cents ?? 0) > 0;
  const currency = balance?.currency_code;

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle>Fee balance</CardTitle>
          <CardDescription>
            Derived from the full fee ledger every time it&apos;s read, so it always reconciles.
          </CardDescription>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent>
        <div className={spacious ? "grid gap-8 sm:grid-cols-2" : "grid gap-6 sm:grid-cols-2"}>
          <div className="space-y-1">
            <p className="text-muted-foreground text-sm">Outstanding balance</p>
            {isLoading || !balance ? (
              <Skeleton className="h-10 w-44" />
            ) : (
              <>
                <p
                  className={`tabular-nums ${spacious ? "text-4xl" : "text-3xl"} font-semibold ${
                    owes ? "text-destructive" : ""
                  }`}
                >
                  {formatMoney(balance.balance_cents, currency)}
                </p>
                <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                  {owes ? (
                    <>
                      <AlertTriangle className="text-destructive size-4" aria-hidden="true" />
                      Owing
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      Nothing owing
                    </>
                  )}
                </p>
              </>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground text-sm">Available credit</p>
            {isLoading || !balance ? (
              <Skeleton className="h-10 w-44" />
            ) : (
              <>
                <p className={`tabular-nums ${spacious ? "text-4xl" : "text-3xl"} font-semibold`}>
                  {formatMoney(balance.available_credit_cents, currency)}
                </p>
                <p className="text-muted-foreground text-sm">
                  {balance.available_credit_cents > 0
                    ? "Applied automatically to the next invoice."
                    : "No credit carried forward."}
                </p>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
