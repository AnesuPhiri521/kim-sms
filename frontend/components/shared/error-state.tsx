import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";

type ErrorStateProps = {
  error?: unknown;
  title?: string;
  onRetry?: () => void;
};

/** Inline error state (not a toast that disappears) for anything that failed to load (doc 17). */
export function ErrorState({ error, title = "Something went wrong", onRetry }: ErrorStateProps) {
  const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : undefined;

  return (
    <div className="border-destructive/30 bg-destructive/5 flex flex-col items-center justify-center gap-3 rounded-md border py-16 px-4 text-center">
      <AlertTriangle className="text-destructive size-10" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {message ? <p className="text-muted-foreground max-w-sm text-sm">{message}</p> : null}
      </div>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry} className="mt-2">
          <RotateCw className="size-4" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}
