"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { centsToDollarsInput, dollarsToCents } from "@/lib/money";

type MoneyInputProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  name?: string;
  currencyCode: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
};

/**
 * Formatted numeric money input (doc 17: "Money and score fields use a
 * masked/formatted numeric input ... so a typo can't silently submit $3000
 * instead of $30.00").
 *
 * The value it holds is always a plain dollars string ("30.00"); the
 * caller converts it to integer cents with `dollarsToCents()` at submit
 * time. Keystrokes that couldn't be part of a valid amount are rejected
 * outright rather than silently coerced, and on blur a parseable amount is
 * normalized to two decimals so what the user sees is exactly what will be
 * sent.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, onBlur, name, currencyCode, placeholder = "0.00", disabled, id },
  ref
) {
  return (
    <div className="relative">
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">
        {currencyCode}
      </span>
      <Input
        ref={ref}
        id={id}
        name={name}
        className="pl-14 text-right tabular-nums"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          // Allow the in-progress states a user types through ("", "1",
          // "1.", "1.5") but never letters, a second dot, or a third
          // decimal place.
          if (next === "" || /^\d{0,12}(\.\d{0,2})?$/.test(next)) onChange(next);
        }}
        onBlur={() => {
          const cents = dollarsToCents(value);
          if (cents !== null) onChange(centsToDollarsInput(cents));
          onBlur?.();
        }}
      />
    </div>
  );
});
