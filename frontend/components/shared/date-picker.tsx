"use client";

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
};

/** Single-date picker composed from Popover + Calendar (doc 03: no third-party date-picker library). */
export function DatePicker({ value, onChange, placeholder = "Pick a date", disabled }: DatePickerProps) {
  const date = value ? new Date(`${value}T00:00:00`) : undefined;
  return (
    <Popover>
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
        <Calendar mode="single" selected={date} onSelect={(d) => onChange(d ? d.toISOString().slice(0, 10) : undefined)} />
      </PopoverContent>
    </Popover>
  );
}
