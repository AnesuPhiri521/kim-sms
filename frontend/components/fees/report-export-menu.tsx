"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadFile } from "@/lib/api/client";
import type { ReportExportFormat } from "@/lib/api/fee-financial";

const FORMATS: { value: ReportExportFormat; label: string; ext: string }[] = [
  { value: "csv", label: "CSV", ext: "csv" },
  { value: "xlsx", label: "Excel (.xlsx)", ext: "xlsx" },
  { value: "pdf", label: "PDF", ext: "pdf" },
];

type ReportExportMenuProps = {
  /** Builds the API path for a given format, including the current filters. */
  buildPath: (format: ReportExportFormat) => string;
  /** File name stem, e.g. "fee-collection-report". Extension is appended. */
  fileName: string;
  disabled?: boolean;
};

/** "Export ▾" — CSV / Excel / PDF download of whatever the report currently shows. */
export function ReportExportMenu({ buildPath, fileName, disabled }: ReportExportMenuProps) {
  const [busy, setBusy] = useState(false);

  async function run(format: ReportExportFormat, ext: string) {
    setBusy(true);
    try {
      await downloadFile(buildPath(format), `${fileName}.${ext}`);
    } catch {
      toast.error("Couldn't generate the export");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {FORMATS.map((f) => (
          <DropdownMenuItem key={f.value} onSelect={() => run(f.value, f.ext)}>
            {f.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
