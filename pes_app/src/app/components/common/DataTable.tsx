import { cn } from "../ui/utils";

export interface DataColumn<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
  headClassName?: string;
}

const ALIGN = { left: "text-left", center: "text-center", right: "text-right" } as const;

/**
 * The one table style: compact rows that highlight on hover, a header that
 * stays in view while a long table scrolls, and, given `renderCard`, a stack
 * of cards at phone width instead of a table squeezed sideways.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  renderCard,
  maxHeight,
  rowClassName,
  onRowClick,
  caption,
  empty,
  className,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** The phone layout of one row. Without it the table scrolls sideways. */
  renderCard?: (row: T) => React.ReactNode;
  /** Long tables scroll inside this height, with the header pinned. */
  maxHeight?: string;
  rowClassName?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
  /** Read by screen readers. */
  caption?: string;
  empty?: React.ReactNode;
  className?: string;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className={className}>
      <div
        className={cn("overflow-auto", renderCard && "hidden sm:block")}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="w-full border-collapse text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
            <tr className="border-b border-border">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "px-4 py-2.5 text-xs font-medium text-muted-foreground",
                    ALIGN[c.align ?? "left"],
                    c.headClassName,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-b border-border/60 last:border-0 transition-colors hover:bg-muted/40",
                  onRowClick && "cursor-pointer",
                  rowClassName?.(row),
                )}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-4 py-2.5 align-middle", ALIGN[c.align ?? "left"], c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {renderCard && (
        <ul className="divide-y divide-border/60 sm:hidden">
          {rows.map((row) => (
            <li key={rowKey(row)} className={cn("px-4 py-3", rowClassName?.(row))}>
              {renderCard(row)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
