"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type DatePickerProps = {
  value?: string | null; // ISO yyyy-mm-dd
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Earliest selectable year in the dropdown (default: 100 years ago). */
  fromYear?: number;
  /** Latest selectable year in the dropdown (default: 10 years from now). */
  toYear?: number;
};

/** Single-date picker composed from Popover + Calendar (doc 03: no third-party date-picker library). */
export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled,
  fromYear,
  toYear,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const date = value ? new Date(`${value}T00:00:00`) : undefined;
  const currentYear = new Date().getFullYear();
  const startYear = fromYear ?? currentYear - 100;
  const endYear = toYear ?? currentYear + 10;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
        >
          <CalendarIcon className="size-4" />
          {date ? format(date, "PPP") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date}
          captionLayout="dropdown"
          startMonth={new Date(startYear, 0)}
          endMonth={new Date(endYear, 11)}
          onSelect={(d) => {
            onChange(d ? format(d, "yyyy-MM-dd") : undefined);
            if (d) setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
