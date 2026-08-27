// Money handling for the Fee & Financial module (doc 08).
//
// The single rule this file exists to enforce: **every amount that crosses
// the API boundary is an integer number of cents**, and no float arithmetic
// is ever performed on it. `0.1 + 0.2` problems are real money problems
// here, so conversions between the cents the server speaks and the
// dollars-and-cents a human types are done with integer/string math only.
//
// Display formatting deliberately uses `(cents / 100).toFixed(2)`: a single
// division of an integer by 100 followed by fixed-2 rounding is exact for
// every amount this system will ever hold, and it is the only place a
// division happens at all.

/** The currency code used when school settings haven't been read (or aren't readable by this role). */
export const DEFAULT_CURRENCY_CODE = "USD";

/**
 * Parses a user-typed dollars amount ("250", "250.5", "1,250.00") into an
 * integer number of cents, using string math so no float rounding can
 * creep in. Returns `null` if the input isn't a well-formed amount —
 * callers surface that as an inline field error, never as a silent 0.
 */
export function dollarsToCents(input: string): number | null {
  const normalized = input.trim().replace(/,/g, "");
  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(normalized)) return null;

  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  // Pad (never round) — "250.5" is 250 dollars 50 cents, not 5 cents.
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Integer cents -> the plain "250.00" string a money `Input` should hold. */
export function centsToDollarsInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Integer cents -> a display string with the school's currency code, e.g.
 * `USD 1,250.00`. Never used as an input value (see `centsToDollarsInput`).
 */
export function formatMoney(cents: number, currencyCode: string = DEFAULT_CURRENCY_CODE): string {
  const negative = cents < 0;
  const [whole, fraction] = (Math.abs(cents) / 100).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${currencyCode} ${grouped}.${fraction}`;
}

/** Percentage helper for report rows — the backend already computed the rate. */
export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
