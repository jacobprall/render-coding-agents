"use client";

import { useState, Fragment } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  getSortedRowModel,
  flexRender,
  type ExpandedState,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronRight, Activity, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { columns } from "./columns";
import type { EventRow } from "./use-events";

interface EventsTableProps {
  events: EventRow[];
  isLoading: boolean;
  total: number;
  nextCursor: string | null;
  onLoadMore?: () => void;
}

function MetadataPanel({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground">
        No metadata available
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      <pre className="max-h-48 overflow-auto text-xs font-mono text-muted-foreground bg-muted p-3 border border-border">
        {JSON.stringify(metadata, null, 2)}
      </pre>
    </div>
  );
}

export function EventsTable({ events, isLoading, total, nextCursor, onLoadMore }: EventsTableProps) {
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: events,
    columns,
    state: { expanded, sorting },
    onExpandedChange: setExpanded,
    onSortingChange: setSorting,
    getRowCanExpand: () => true,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (!isLoading && events.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="h-5 w-5" />}
        title="No events recorded"
        description="Events will appear here once agent sessions generate observability data."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted-foreground">
        {total > 0 && `${total.toLocaleString()} total events`}
      </div>

      <div className="overflow-x-auto border border-border">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border bg-muted/50">
                <th className="w-8 px-2 py-2" />
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta as { className?: string } | undefined;
                  return (
                    <th
                      key={header.id}
                      className={`px-3 py-2 text-left text-xs font-medium text-muted-foreground ${meta?.className ?? ""}`}
                      style={{ width: header.getSize() }}
                    >
                      {header.isPlaceholder ? null : (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getIsSorted() === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : header.column.getIsSorted() === "desc" ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading && events.length === 0
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="px-2 py-3" />
                    {columns.map((_, ci) => (
                      <td key={ci} className="px-3 py-3">
                        <div className="h-4 w-20 animate-pulse bg-muted" />
                      </td>
                    ))}
                  </tr>
                ))
              : table.getRowModel().rows.map((row) => (
                  <Fragment key={row.id}>
                    <tr
                      className="border-b border-border hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => row.toggleExpanded()}
                    >
                      <td className="px-2 py-2 text-center">
                        <ChevronRight
                          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                            row.getIsExpanded() ? "rotate-90" : ""
                          }`}
                        />
                      </td>
                      {row.getVisibleCells().map((cell) => {
                        const meta = cell.column.columnDef.meta as { className?: string } | undefined;
                        return (
                          <td key={cell.id} className={`px-3 py-2 ${meta?.className ?? ""}`}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                    {row.getIsExpanded() && (
                      <tr className="border-b border-border bg-muted/20">
                        <td colSpan={columns.length + 1}>
                          <MetadataPanel metadata={row.original.metadata} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
          </tbody>
        </table>
      </div>

      {nextCursor && (
        <div className="flex justify-center pt-2">
          <button
            onClick={onLoadMore}
            disabled={isLoading}
            className="px-4 py-1.5 text-sm font-medium border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {isLoading ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
