import { useQuery } from "@tanstack/react-query";
import { listSystemSettings } from "@/lib/api/system-settings";
import { DEFAULT_CURRENCY_CODE } from "@/lib/money";

export const currencySettingKey = ["system-settings", "finance"] as const;

/**
 * The school's currency code (doc 08: "All amounts are recorded in whatever
 * currency `system_settings.currency_code` is set to").
 *
 * Two sources, in priority order:
 *  1. `override` — the `currency_code` the fee API already returned on a
 *     `GET /students/{id}/fee-balance` response. Parents and students can
 *     read that but *cannot* read `/system-settings` (it needs
 *     `system_settings:view`), so on their screens this is the only source.
 *  2. `/system-settings?category=finance`, for back-office screens that
 *     have no student in context (structures, reports, cash-up).
 *
 * Falls back to `USD` (the backend's own default) rather than rendering a
 * bare number with no currency — an amount without a currency is worse
 * than a possibly-stale currency label.
 */
export function useCurrencyCode(override?: string | null): string {
  const { data } = useQuery({
    queryKey: currencySettingKey,
    queryFn: () => listSystemSettings("finance"),
    staleTime: 5 * 60 * 1000,
    // A 403 here is expected for parent/student roles — don't retry it and
    // don't surface it; the `override` path covers those screens.
    retry: false,
  });

  if (override) return override;
  return data?.find((setting) => setting.key === "currency_code")?.value ?? DEFAULT_CURRENCY_CODE;
}
