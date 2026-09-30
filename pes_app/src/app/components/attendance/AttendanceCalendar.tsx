import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { Calendar } from "../ui/calendar";
import { Button } from "../ui/button";
import { cn } from "../ui/utils";
import { CourseCode, SectionCard, StatusBadge } from "../common";
import type { StatusTone } from "../common/StatusBadge";

export interface AttendanceRecord {
  date: string; // "YYYY-MM-DD" from the `attendance.lecture_date` column
  status: "present" | "absent" | "excused";
}

interface AttendanceCalendarProps {
  courseCode: string;
  courseName: string;
  records: AttendanceRecord[];
}

const STATUS_TONE: Record<AttendanceRecord["status"], StatusTone> = {
  present: "success",
  absent: "danger",
  excused: "info",
};

const STATUS_LABEL: Record<AttendanceRecord["status"], string> = {
  present: "Present",
  absent: "Absent",
  excused: "Excused",
};

const STATUS_DOT: Record<AttendanceRecord["status"] | "none", string> = {
  present: "bg-success-fg",
  absent: "bg-danger-fg",
  excused: "bg-info-fg",
  none: "bg-neutral-fg",
};

/**
 * Course-scoped attendance calendar. Colours each day the student's actual
 * recorded status; a day with no attendance row is left neutral rather than
 * guessed at — the schema has no concept of a scheduled-but-unmarked lecture,
 * so "no record" is the only honest label for it (covers both "no class
 * held" and "not entered yet", which this data cannot tell apart).
 */
export function AttendanceCalendar({
  courseCode,
  courseName,
  records,
}: AttendanceCalendarProps) {
  const reduce = useReducedMotion();

  const recordsByDate = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    records.forEach((r) => map.set(r.date, r));
    return map;
  }, [records]);

  // Chronological order, for the "Lecture N of M" ordinal shown per date —
  // a real, derived position in this course's actual records, not a
  // fabricated session number (the schema has no such field).
  const chronological = useMemo(
    () => [...records].sort((a, b) => a.date.localeCompare(b.date)),
    [records],
  );

  const initialMonth = useMemo(() => {
    const latest = chronological[chronological.length - 1];
    return startOfMonth(latest ? parseISO(latest.date) : new Date());
  }, [chronological]);

  const [month, setMonth] = useState(initialMonth);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const modifiers = useMemo(
    () => ({
      present: records.filter((r) => r.status === "present").map((r) => parseISO(r.date)),
      absent: records.filter((r) => r.status === "absent").map((r) => parseISO(r.date)),
      excused: records.filter((r) => r.status === "excused").map((r) => parseISO(r.date)),
    }),
    [records],
  );

  const hasLectureThisMonth = chronological.some((r) =>
    isSameMonth(parseISO(r.date), month),
  );

  const selectedKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;
  const selectedRecord = selectedKey ? recordsByDate.get(selectedKey) ?? null : null;
  const selectedOrdinal = selectedRecord
    ? chronological.findIndex((r) => r.date === selectedKey) + 1
    : null;

  return (
    <SectionCard
      title="Attendance Calendar"
      description={
        <>
          <CourseCode code={courseCode} /> — {courseName}
        </>
      }
      flush
      actions={
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5"
            onClick={() => setMonth(startOfMonth(new Date()))}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Previous month"
            onClick={() => setMonth((m) => subMonths(m, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium text-foreground w-28 text-center tabular-nums">
            {format(month, "MMMM yyyy")}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Next month"
            onClick={() => setMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        {!hasLectureThisMonth && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
            No lectures recorded for <CourseCode code={courseCode} /> in {format(month, "MMMM yyyy")}.
          </p>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={format(month, "yyyy-MM")}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: -8 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
            className="flex justify-center"
          >
            <Calendar
              mode="single"
              month={month}
              onMonthChange={setMonth}
              selected={selectedDate ?? undefined}
              onSelect={(d) => setSelectedDate(d ?? null)}
              modifiers={modifiers}
              showOutsideDays
              classNames={{
                caption: "hidden",
                nav: "hidden",
                day: "size-9 sm:size-10 p-0 font-normal aria-selected:opacity-100",
                day_selected:
                  "ring-2 ring-primary ring-offset-1 ring-offset-background rounded-full bg-transparent text-inherit hover:bg-transparent focus:bg-transparent",
                day_today: "",
              }}
              components={{
                DayContent: ({ date }) => {
                  const key = format(date, "yyyy-MM-dd");
                  const record = recordsByDate.get(key);
                  const today = isSameDay(date, new Date());
                  const label = record
                    ? `${format(date, "MMMM d, yyyy")}, ${STATUS_LABEL[record.status]}`
                    : `${format(date, "MMMM d, yyyy")}, no attendance record`;
                  return (
                    <span
                      aria-label={label}
                      className={cn(
                        "flex h-full w-full items-center justify-center rounded-full text-sm transition-colors",
                        record?.status === "present" &&
                          "bg-success-bg text-success-fg font-semibold",
                        record?.status === "absent" &&
                          "bg-danger-bg text-danger-fg font-semibold",
                        record?.status === "excused" &&
                          "bg-info-bg text-info-fg font-semibold",
                        !record && today && "ring-1 ring-primary/50 font-medium",
                        !record && !today && "text-muted-foreground",
                      )}
                    >
                      {date.getDate()}
                    </span>
                  );
                },
              }}
            />
          </motion.div>
        </AnimatePresence>

        {/* Legend — colour is never the only signal; each swatch is paired
            with a text label, and every day cell also carries an aria-label. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 justify-center pt-1 border-t border-border/60">
          {(["present", "excused", "absent"] as const).map((s) => (
            <div key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_DOT[s])} aria-hidden="true" />
              {STATUS_LABEL[s]}
            </div>
          ))}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-full border border-muted-foreground/40" aria-hidden="true" />
            No Record
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-full ring-1 ring-primary/50" aria-hidden="true" />
            Today
          </div>
        </div>

        {/* Detail panel for the clicked date — a fixed panel rather than a
            floating popover per cell, so it works the same on touch as it
            does with a mouse. */}
        <AnimatePresence>
          {selectedDate && (
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={{ duration: reduce ? 0 : 0.2 }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border border-border bg-muted/40 p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    {format(selectedDate, "EEEE, MMMM d, yyyy")}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedDate(null)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Close date details"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  <CourseCode code={courseCode} /> — {courseName}
                </p>
                {selectedRecord ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <StatusBadge tone={STATUS_TONE[selectedRecord.status]}>
                      {STATUS_LABEL[selectedRecord.status]}
                    </StatusBadge>
                    {selectedOrdinal && (
                      <span className="text-xs text-muted-foreground">
                        Lecture {selectedOrdinal} of {chronological.length}
                      </span>
                    )}
                    {selectedRecord.status === "excused" && (
                      <span className="text-xs text-muted-foreground w-full">
                        This absence was recorded as excused — it counts toward
                        your attendance the same way a present mark does.
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground pt-1">
                    No attendance record exists for this date.
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </SectionCard>
  );
}
