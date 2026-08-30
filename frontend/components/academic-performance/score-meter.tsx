import { averageBadgeVariant, formatPct } from "@/lib/display/academic-performance";
import { cn } from "@/lib/utils";

/**
 * Inline 0-100% meter used wherever a weighted average is shown in a
 * dense grid (student subject cards, teacher heatmap, principal
 * analytics).
 *
 * Deliberately not a chart component: the app's `--chart-1..5` palette is
 * monochrome (see app/globals.css), so a multi-series recharts line/bar
 * would render as five near-identical greys. A width-proportional bar
 * keyed to the shared `averageBadgeVariant` banding reads better, keeps
 * the four screens visually consistent, and adds no dependency.
 */
const FILL_CLASS: Record<string, string> = {
  destructive: "bg-destructive",
  secondary: "bg-foreground/50",
  default: "bg-primary",
  outline: "bg-muted-foreground/30",
};

export function ScoreMeter({
  value,
  className,
  barClassName,
  showLabel = true,
}: {
  value: number | null | undefined;
  className?: string;
  /** Override the track width, e.g. `w-full` on a card. */
  barClassName?: string;
  showLabel?: boolean;
}) {
  const pct = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value));
  const fill = FILL_CLASS[averageBadgeVariant(value)] ?? FILL_CLASS.outline;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className={cn("bg-muted h-2 w-16 shrink-0 overflow-hidden rounded-full", barClassName)}
        role="meter"
        aria-valuenow={value ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Weighted average ${formatPct(value)}`}
      >
        <div className={cn("h-full rounded-full", fill)} style={{ width: `${pct}%` }} />
      </div>
      {showLabel ? <span className="text-xs tabular-nums">{formatPct(value)}</span> : null}
    </div>
  );
}
