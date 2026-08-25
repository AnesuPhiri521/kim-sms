"use client";

import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";

export type ServerPagination = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
};

type DataTableProps<TData> = {
  columns: ColumnDef<TData, unknown>[];
  data: TData[] | undefined;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  /** Omit for small, unpaginated resources (client-side sort/paginate); pass for server-paginated lists (doc 03: every list that can grow large). */
  serverPagination?: ServerPagination;
  /** Row click for navigating to a detail view. */
  onRowClick?: (row: TData) => void;
};

/**
 * The one shared DataTable used by every list screen (doc 02 code-reuse) —
 * built on TanStack Table + shadcn Table, with sortable columns and either
 * server-side pagination (reading meta.page/page_size/total) or client-side
 * pagination for small, unpaginated resources.
 */
export function DataTable<TData>({
  columns,
  data,
  isLoading,
  isError,
  error,
  onRetry,
  emptyTitle = "No records yet",
  emptyDescription,
  emptyActionLabel,
  onEmptyAction,
  serverPagination,
  onRowClick,
}: DataTableProps<TData>) {
  const rows = data ?? [];

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: serverPagination ? undefined : getSortedRowModel(),
    getPaginationRowModel: serverPagination ? undefined : getPaginationRowModel(),
    manualPagination: Boolean(serverPagination),
  });

  if (isLoading) {
    return <TableSkeleton columns={columns.length} />;
  }

  if (isError) {
    return <ErrorState error={error} title="Couldn't load this list" onRetry={onRetry} />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        actionLabel={emptyActionLabel}
        onAction={onEmptyAction}
      />
    );
  }

  const pageCount = serverPagination ? Math.max(1, Math.ceil(serverPagination.total / serverPagination.pageSize)) : table.getPageCount();
  const currentPage = serverPagination ? serverPagination.page : table.getState().pagination.pageIndex + 1;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          className="flex items-center gap-1 font-medium"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3.5" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3.5" />
                          ) : (
                            <ArrowUpDown className="text-muted-foreground size-3.5" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={onRowClick ? "cursor-pointer" : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {serverPagination ? `${serverPagination.total} total` : `${rows.length} total`}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">
            Page {currentPage} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon"
            disabled={currentPage <= 1}
            onClick={() =>
              serverPagination ? serverPagination.onPageChange(currentPage - 1) : table.previousPage()
            }
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={currentPage >= pageCount}
            onClick={() =>
              serverPagination ? serverPagination.onPageChange(currentPage + 1) : table.nextPage()
            }
            aria-label="Next page"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export type { ColumnDef, SortingState, OnChangeFn };
