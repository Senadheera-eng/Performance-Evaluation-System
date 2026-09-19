import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { History } from "lucide-react";
import {
  EmptyState,
  SectionCard,
  SegmentedTabs,
  StatusBadge,
} from "../common";
import type { StatusTone } from "../common/StatusBadge";

export interface HistoryRecord {
  date: string; // "YYYY-MM-DD"
  status: "present" | "absent" | "excused";
  courseCode: string;
  courseName: string;
}

interface AttendanceHistoryListProps {
  records: HistoryRecord[];
}

const STATUS_TONE: Record<HistoryRecord["status"], StatusTone> = {
  present: "success",
  absent: "danger",
  excused: "info",
};

const STATUS_LABEL: Record<HistoryRecord["status"], string> = {
  present: "Present",
  absent: "Absent",
  excused: "Excused",
};

type Filter = "all" | HistoryRecord["status"];

/**
 * Chronological record list, independent of the calendar's currently
 * selected month — the calendar answers "what happened on this date",
 * this answers "show me every Absent record for this course".
 */
export function AttendanceHistoryList({ records }: AttendanceHistoryListProps) {
  const [filter, setFilter] = useState<Filter>("all");

  const sorted = useMemo(
    () => [...records].sort((a, b) => b.date.localeCompare(a.date)),
    [records],
  );

  const counts = useMemo(
    () => ({
      all: sorted.length,
      present: sorted.filter((r) => r.status === "present").length,
      absent: sorted.filter((r) => r.status === "absent").length,
      excused: sorted.filter((r) => r.status === "excused").length,
    }),
    [sorted],
  );

  const filtered =
    filter === "all" ? sorted : sorted.filter((r) => r.status === filter);

  return (
    <SectionCard
      title="Attendance History"
      description="Every recorded lecture, most recent first."
      actions={
        <SegmentedTabs
          aria-label="Filter attendance history"
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          layoutId="attendance-history-filter"
          tabs={[
            { value: "all", label: "All", count: counts.all },
            { value: "present", label: "Present", count: counts.present },
            { value: "absent", label: "Absent", count: counts.absent },
            { value: "excused", label: "Excused", count: counts.excused },
          ]}
        />
      }
      bodyClassName="p-0"
    >
      {filtered.length === 0 ? (
        <EmptyState
          icon={History}
          title={
            filter === "all"
              ? "No attendance recorded yet"
              : `No ${STATUS_LABEL[filter as HistoryRecord["status"]].toLowerCase()} records`
          }
          description={
            filter === "all"
              ? "Records will appear here once your department admin starts marking lectures."
              : undefined
          }
          size="inline"
        />
      ) : (
        <ul className="divide-y divide-border/70 max-h-96 overflow-y-auto">
          {filtered.map((r) => (
            <li
              key={`${r.courseCode}-${r.date}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  {format(parseISO(r.date), "EEEE, MMMM d, yyyy")}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {r.courseCode} — {r.courseName}
                </p>
              </div>
              <StatusBadge tone={STATUS_TONE[r.status]} className="flex-shrink-0">
                {STATUS_LABEL[r.status]}
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
