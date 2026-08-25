"use client";

import { CalendarIcon, Search, X } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type FilterOption = { value: string; label: string };

export type FilterField =
  | { type: "search"; name: string; label: string; placeholder?: string }
  | { type: "select"; name: string; label: string; options: FilterOption[]; placeholder?: string }
  | { type: "date-range"; name: string; label: string };

export type FilterValues = Record<string, string | { from?: string; to?: string } | undefined>;

type FilterBarProps = {
  fields: FilterField[];
  values: FilterValues;
  onChange: (name: string, value: FilterValues[string]) => void;
  onClear?: () => void;
};

/**
 * Renders filter controls from a declarative field config (doc 02/03/06) —
 * every list screen's filters go through this instead of a bespoke filter
 * UI. Backed entirely by shadcn primitives (Input, Select, Popover+Calendar).
 */
export function FilterBar({ fields, values, onChange, onClear }: FilterBarProps) {
  const hasActiveFilters = Object.values(values).some((v) => (typeof v === "string" ? v.length > 0 : Boolean(v?.from || v?.to)));

  return (
    <div className="flex flex-wrap items-end gap-3">
      {fields.map((field) => {
        if (field.type === "search") {
          const value = (values[field.name] as string) ?? "";
          return (
            <div key={field.name} className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" htmlFor={`filter-${field.name}`}>
                {field.label}
              </label>
              <div className="relative">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                  id={`filter-${field.name}`}
                  className="w-48 pl-8"
                  placeholder={field.placeholder}
                  value={value}
                  onChange={(e) => onChange(field.name, e.target.value)}
                />
              </div>
            </div>
          );
        }

        if (field.type === "select") {
          const value = (values[field.name] as string) ?? "";
          return (
            <div key={field.name} className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">{field.label}</label>
              <Select value={value || undefined} onValueChange={(v) => onChange(field.name, v)}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder={field.placeholder ?? "All"} />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        }

        // date-range
        const rangeValue = (values[field.name] as { from?: string; to?: string }) ?? {};
        const fromDate = rangeValue.from ? new Date(rangeValue.from) : undefined;
        const toDate = rangeValue.to ? new Date(rangeValue.to) : undefined;
        return (
          <div key={field.name} className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">{field.label}</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-56 justify-start text-left font-normal", !fromDate && !toDate && "text-muted-foreground")}
                >
                  <CalendarIcon className="size-4" />
                  {fromDate ? format(fromDate, "PP") : "Start"} — {toDate ? format(toDate, "PP") : "End"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={{ from: fromDate, to: toDate }}
                  onSelect={(range) =>
                    onChange(field.name, {
                      from: range?.from ? range.from.toISOString().slice(0, 10) : undefined,
                      to: range?.to ? range.to.toISOString().slice(0, 10) : undefined,
                    })
                  }
                />
              </PopoverContent>
            </Popover>
          </div>
        );
      })}
      {hasActiveFilters && onClear ? (
        <Button variant="ghost" size="sm" onClick={onClear} className="mb-0.5">
          <X className="size-4" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
