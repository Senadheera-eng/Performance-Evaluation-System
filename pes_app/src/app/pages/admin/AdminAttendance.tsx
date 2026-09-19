import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  CheckCircle2,
  QrCode,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  TrendingDown,
  Users,
  XCircle,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Calendar } from "../../components/ui/calendar";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SegmentedTabs,
  SkeletonRows,
  StatCard,
  StatusBadge,
} from "../../components/common";
import { OfferingPicker } from "../../components/staff/OfferingPicker";
import { TIER_TONE } from "../../components/attendance/AttendanceOverview";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../../lib/settings";
import { describeBatch } from "../../../lib/batch";
import { formatRegNumber } from "../../../lib/format";
import {
  classifyTier,
  percentageOf,
  totalCount,
  TIER_LABEL,
} from "../../../lib/attendanceMath";
import { getOfferingRoster, type AttendanceStatus } from "../../../lib/staffService";
import {
  getAttendanceOfferings,
  getLectureDates,
  getOfferingAttendanceSummary,
  getSessionMarks,
  localDateISO,
  OWN_WRITE_ECHO_MS,
  saveSession,
  useAttendanceLive,
  type AttendanceOffering,
  type StudentAttendanceSummary,
} from "../../../lib/attendanceRegister";

type View = "overall" | "sessions";

const VIEWS = [
  { value: "overall", label: "Overall" },
  { value: "sessions", label: "By lecture date" },
];

/**
 * Attendance for the department office, in the two ways it is asked about.
 *
 * Overall: pick a batch and a course, see every student's attendance for it
 * — the question "who is below the line?" answered at a glance.
 *
 * By lecture date: pick a course and a day on the calendar, see that
 * lecture's register, and correct it.
 *
 * Both read the same register the lecturer marks, keyed the same way (the
 * offering), and both update live when anyone — lecturer, register, office —
 * changes it. The course chosen carries across the two views.
 */
export default function AdminAttendance() {
  const { student } = useAuth();
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "sessions" ? "sessions" : "overall";
  const offeringId = params.get("offering") ?? "";

  const [offerings, setOfferings] = useState<AttendanceOffering[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setParam = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  /* Quietly after a save: only the lecture counts under the picker change,
     and blanking the picker to show them would make the page jump. */
  const loadOfferings = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    const result = await getAttendanceOfferings();
    if (!result.ok) {
      setError("We could not load your department's courses. Please try again.");
    } else {
      setOfferings(result.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (student && student.role !== "super_admin") loadOfferings();
  }, [student, loadOfferings]);

  const selected = offerings.find((o) => o.offering_id === offeringId) ?? null;

  // The sidebar does not offer this to a super admin; typing the URL should
  // not be the way round that. A register belongs to the department that
  // delivers the course, and reading one student's day by day is its business.
  if (student?.role === "super_admin") {
    return (
      <div className="space-y-5">
        <PageHeader title="Attendance" />
        <EmptyState
          icon={CalendarIcon}
          title="Attendance is kept by the department"
          description="Registers are marked against the courses a department delivers, so they are read and corrected there. Faculty-wide attendance figures are on the dashboard."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Attendance"
        description={
          view === "overall"
            ? "Each student's attendance for a course, from every lecture recorded so far."
            : "One lecture's register. Pick a date to see who was marked, and correct it if needed."
        }
        actions={
          <SegmentedTabs
            aria-label="Attendance view"
            layoutId="admin-attendance-view"
            tabs={VIEWS}
            value={view}
            onChange={(v) => setParam("view", v === "overall" ? null : v)}
          />
        }
      />

      {error && (
        <ErrorState message={error} onRetry={() => loadOfferings()} size="inline" />
      )}

      <SectionCard title={view === "overall" ? "Batch & course" : "Course"}>
        {loading ? (
          <SkeletonRows count={1} height="h-10" />
        ) : offerings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No course offerings are set up for your department yet.
          </p>
        ) : (
          <OfferingPicker
            offerings={offerings}
            value={offeringId}
            onChange={(id) => {
              if (id === offeringId) return;
              /* A date belongs to one course's lectures; carrying it to the
                 next course would open that course on a day it never met. */
              setParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  next.set("offering", id);
                  next.delete("date");
                  return next;
                },
                { replace: true },
              );
            }}
          />
        )}
        {selected && (
          <p className="mt-2 text-xs text-muted-foreground">
            {describeBatch(selected.batch_year)} · {selected.academic_year} ·{" "}
            {selected.student_count} student{selected.student_count === 1 ? "" : "s"} ·{" "}
            {selected.lectures_held === 0
              ? "no lectures recorded yet"
              : `${selected.lectures_held} lecture${selected.lectures_held === 1 ? "" : "s"} recorded, most recently ${selected.last_lecture}`}
          </p>
        )}
      </SectionCard>

      {selected &&
        (view === "overall" ? (
          <OverallView
            key={selected.offering_id}
            offering={selected}
            onOpenSessions={() => setParam("view", "sessions")}
          />
        ) : (
          <SessionView
            key={selected.offering_id}
            offering={selected}
            date={params.get("date")}
            onDateChange={(d) => setParam("date", d)}
            onSaved={() => loadOfferings(true)}
          />
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overall                                                             */
/* ------------------------------------------------------------------ */

function OverallView({
  offering,
  onOpenSessions,
}: {
  offering: AttendanceOffering;
  onOpenSessions: () => void;
}) {
  const settings = useSettings();
  const threshold = settings.attendanceThreshold;
  const prewarning = settings.attendancePrewarningThreshold;

  const [rows, setRows] = useState<StudentAttendanceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"index" | "lowest">("index");

  const load = useCallback(async () => {
    const result = await getOfferingAttendanceSummary(offering.offering_id);
    if (!result.ok) {
      setError("We could not load attendance for this course.");
    } else {
      setError(null);
      setRows(result.data);
    }
    setLoading(false);
  }, [offering.offering_id]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  /* Read-only, so a change elsewhere can simply be pulled in. */
  useAttendanceLive(offering.offering_id, load);

  const enriched = useMemo(
    () =>
      rows.map((r) => {
        const counts = { present: r.present, absent: r.absent, excused: r.excused };
        const total = totalCount(counts);
        const pct = percentageOf(counts);
        return {
          ...r,
          total,
          pct,
          tier: classifyTier(pct, total, threshold, prewarning),
        };
      }),
    [rows, threshold, prewarning],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = enriched.filter(
      (r) =>
        !q ||
        r.name.toLowerCase().includes(q) ||
        (r.index_number ?? "").toLowerCase().includes(q) ||
        (r.reg_number ?? "").toLowerCase().includes(q),
    );
    if (sort === "lowest") {
      /* Students with no marks yet go last: "no record" is not "0%". */
      list.sort(
        (a, b) =>
          Number(a.total === 0) - Number(b.total === 0) || a.pct - b.pct,
      );
    }
    return list;
  }, [enriched, query, sort]);

  const marked = enriched.filter((r) => r.total > 0);
  const average =
    marked.length > 0
      ? Math.round(marked.reduce((sum, r) => sum + r.pct, 0) / marked.length)
      : null;
  const below = marked.filter((r) => r.pct < threshold).length;
  const held = rows[0]?.lectures_held ?? offering.lectures_held;

  if (loading) {
    return (
      <SectionCard title="Students">
        <SkeletonRows count={6} height="h-12" />
      </SectionCard>
    );
  }
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard index={0} label="Students" value={rows.length} icon={Users} />
        <StatCard
          index={1}
          label="Lectures recorded"
          value={held}
          icon={CalendarIcon}
          tone="info"
        />
        <StatCard
          index={2}
          label="Class average"
          value={average === null ? "—" : `${average}%`}
          icon={CheckCircle2}
          tone={average === null ? "neutral" : average < threshold ? "danger" : "success"}
        />
        <StatCard
          index={3}
          label={`Below ${threshold}%`}
          value={below}
          icon={TrendingDown}
          tone={below > 0 ? "danger" : "success"}
        />
      </div>

      <SectionCard
        title={`${offering.course_code} — ${offering.course_title}`}
        description={`Students need ${threshold}% to sit the end-of-semester examination. Excused absences count as attended.`}
        actions={
          <Button size="sm" variant="outline" onClick={onOpenSessions}>
            <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
            By lecture date
          </Button>
        }
        flush
      >
        <div className="flex flex-col gap-2 border-b border-border/70 p-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, index or registration number..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 bg-card pl-9"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            aria-label="Sort students"
            className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="index">By index number</option>
            <option value="lowest">Lowest attendance first</option>
          </select>
        </div>

        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Users}
              title="No students in this class"
              description="Nobody is enrolled on this course for this batch and year."
            />
          </div>
        ) : visible.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No students match that search.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Student</th>
                  <th className="hidden px-2 py-2 text-center font-medium sm:table-cell">Present</th>
                  <th className="hidden px-2 py-2 text-center font-medium sm:table-cell">Absent</th>
                  <th className="hidden px-2 py-2 text-center font-medium sm:table-cell">Excused</th>
                  <th className="px-4 py-2 font-medium">Attendance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {visible.map((r) => (
                  <tr key={r.student_id}>
                    <td className="px-4 py-2.5">
                      <p className="text-foreground">{r.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.index_number ?? "—"} · {formatRegNumber(r.reg_number)}
                        {r.is_repeat && " · repeat"}
                      </p>
                    </td>
                    <td className="hidden px-2 py-2.5 text-center tabular-nums sm:table-cell">
                      {r.present}
                    </td>
                    <td className="hidden px-2 py-2.5 text-center tabular-nums sm:table-cell">
                      {r.absent}
                    </td>
                    <td className="hidden px-2 py-2.5 text-center tabular-nums sm:table-cell">
                      {r.excused}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.total === 0 ? (
                        <span className="text-xs text-muted-foreground">No marks yet</span>
                      ) : (
                        <div className="flex min-w-[10rem] items-center gap-3">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={
                                r.pct < threshold
                                  ? "h-full bg-danger-fg"
                                  : r.tier === "at_risk"
                                    ? "h-full bg-warning-fg"
                                    : "h-full bg-success-fg"
                              }
                              style={{ width: `${r.pct}%` }}
                            />
                          </div>
                          <span
                            className={`w-10 text-right font-semibold tabular-nums ${
                              r.pct < threshold ? "text-danger-fg" : "text-foreground"
                            }`}
                          >
                            {r.pct}%
                          </span>
                          <StatusBadge tone={TIER_TONE[r.tier]} className="hidden md:inline-flex">
                            {TIER_LABEL[r.tier]}
                          </StatusBadge>
                        </div>
                      )}
                      {/* A student marked in fewer lectures than were held
                          has gaps nobody filled in — worth seeing before
                          trusting the percentage. */}
                      {r.total > 0 && r.total < r.lectures_held && (
                        <p className="mt-0.5 text-[11px] text-warning-fg">
                          Marked in {r.total} of {r.lectures_held} lectures
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* By lecture date                                                     */
/* ------------------------------------------------------------------ */

interface RegisterRow {
  studentId: string;
  name: string;
  indexNumber: string;
  regNumber: string;
  isRepeat: boolean;
  /** What is stored now. */
  saved: AttendanceStatus | null;
  savedMethod: "manual" | "qr" | null;
  /** What the office has set on screen, not yet saved. */
  status: AttendanceStatus | null;
}

const parseDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

function SessionView({
  offering,
  date: dateParam,
  onDateChange,
  onSaved,
}: {
  offering: AttendanceOffering;
  date: string | null;
  onDateChange: (date: string) => void;
  onSaved: () => void;
}) {
  const today = localDateISO();
  const [dates, setDates] = useState<string[]>([]);
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /* Someone else changed this register while the office had edits open. */
  const [stale, setStale] = useState(false);
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState<Date | undefined>(undefined);

  /* The date in the address bar if there is one, else the latest lecture,
     else today — the lecture someone opening this page most likely means. */
  const date = dateParam ?? dates[0] ?? today;

  const dirty = rows.some((r) => r.status !== r.saved);

  const loadDates = useCallback(async () => {
    const result = await getLectureDates(offering.offering_id);
    if (result.ok) setDates(result.data);
  }, [offering.offering_id]);

  const loadRegister = useCallback(async () => {
    const [roster, marks] = await Promise.all([
      getOfferingRoster(offering.offering_id),
      getSessionMarks(offering.offering_id, date),
    ]);
    if (!roster.ok || !marks.ok) {
      setError("We could not load this lecture's register.");
      setLoading(false);
      return;
    }
    setError(null);
    const byStudent = new Map(marks.data.map((m) => [m.student_id, m]));
    setRows(
      roster.data.map((s) => {
        const mark = byStudent.get(s.student_id);
        return {
          studentId: s.student_id,
          name: s.name,
          indexNumber: s.index_number ?? "—",
          regNumber: formatRegNumber(s.reg_number),
          isRepeat: s.is_repeat,
          saved: mark?.status ?? null,
          savedMethod: mark?.method ?? null,
          status: mark?.status ?? null,
        };
      }),
    );
    setStale(false);
    setLoading(false);
  }, [offering.offering_id, date]);

  useEffect(() => {
    loadDates();
  }, [loadDates]);

  useEffect(() => {
    setLoading(true);
    setNotice(null);
    loadRegister();
  }, [loadRegister]);

  useEffect(() => {
    setMonth(parseDate(date));
  }, [date]);

  /* A change from elsewhere is pulled straight in — unless the office has
     edits of its own on screen, which a silent reload would throw away. */
  /* This page's own save echoes back as change events; they are not
     someone else's edit. */
  const ownWriteAt = useRef(0);
  useAttendanceLive(offering.offering_id, () => {
    loadDates();
    if (saving || Date.now() - ownWriteAt.current < OWN_WRITE_ECHO_MS) return;
    if (dirty) setStale(true);
    else loadRegister();
  });

  const pickDate = (next: string) => {
    if (next === date) return;
    if (
      dirty &&
      !window.confirm("You have unsaved changes on this register. Discard them?")
    ) {
      return;
    }
    onDateChange(next);
  };

  const setStatus = (studentId: string, status: AttendanceStatus) =>
    setRows((prev) =>
      prev.map((r) =>
        r.studentId === studentId
          ? { ...r, status: r.status === status ? null : status }
          : r,
      ),
    );

  const markAll = (status: AttendanceStatus) =>
    setRows((prev) => prev.map((r) => ({ ...r, status })));

  const undo = () => setRows((prev) => prev.map((r) => ({ ...r, status: r.saved })));

  const save = async () => {
    const changed = rows.filter((r) => r.status !== r.saved);
    const marks = changed
      .filter((r) => r.status !== null)
      .map((r) => ({ student_id: r.studentId, status: r.status! }));
    const cleared = changed.filter((r) => r.status === null).map((r) => r.studentId);

    ownWriteAt.current = Date.now();
    setSaving(true);
    setError(null);
    const result = await saveSession(
      offering.offering_id,
      offering.course_id,
      date,
      marks,
      cleared,
    );
    ownWriteAt.current = Date.now();
    setSaving(false);
    if (!result.ok) {
      setError("The register could not be saved. Nothing was changed — please try again.");
      return;
    }
    await Promise.all([loadRegister(), loadDates()]);
    onSaved();
    const parts = [
      result.data.saved > 0 && `${result.data.saved} mark${result.data.saved === 1 ? "" : "s"} saved`,
      result.data.cleared > 0 && `${result.data.cleared} removed`,
    ].filter(Boolean);
    setNotice(`${parts.join(", ")} for ${date}.`);
  };

  const present = rows.filter((r) => r.status === "present").length;
  const absent = rows.filter((r) => r.status === "absent").length;
  const excused = rows.filter((r) => r.status === "excused").length;
  const unmarked = rows.filter((r) => r.status === null).length;
  const changedCount = rows.filter((r) => r.status !== r.saved).length;
  const recorded = dates.includes(date);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        !q ||
        r.name.toLowerCase().includes(q) ||
        r.indexNumber.toLowerCase().includes(q) ||
        r.regNumber.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const recordedDays = useMemo(() => dates.map(parseDate), [dates]);

  return (
    <div className="grid gap-5 lg:grid-cols-[auto_1fr]">
      <SectionCard
        title="Lecture date"
        description={
          dates.length === 0
            ? "No lectures recorded yet."
            : `${dates.length} lecture${dates.length === 1 ? "" : "s"} recorded — shown in bold with a dot.`
        }
        bodyClassName="flex justify-center"
      >
        <Calendar
          mode="single"
          selected={parseDate(date)}
          month={month}
          onMonthChange={setMonth}
          onSelect={(d) => d && pickDate(localDateISO(d))}
          disabled={{ after: parseDate(today) }}
          modifiers={{ recorded: recordedDays }}
          modifiersClassNames={{
            recorded:
              "relative font-semibold after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
          }}
        />
      </SectionCard>

      <div className="min-w-0 space-y-4">
        {error && <ErrorState message={error} size="inline" />}
        {notice && (
          <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2 text-sm text-success-fg">
            {notice}
          </div>
        )}
        {stale && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-sm text-warning-fg">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span className="flex-1">
              This register was just changed by someone else. Reload to see it —
              your unsaved changes will be lost.
            </span>
            <Button size="sm" variant="outline" onClick={loadRegister}>
              Reload
            </Button>
          </div>
        )}

        <SectionCard
          title={new Date(parseDate(date)).toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          description={
            recorded
              ? `${offering.course_code} · ${present} present · ${absent} absent · ${excused} excused${unmarked > 0 ? ` · ${unmarked} unmarked` : ""}`
              : `${offering.course_code} · No attendance recorded on this date. Marking students here records the lecture.`
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => markAll("present")}>
                All present
              </Button>
              <Button size="sm" variant="outline" onClick={() => markAll("absent")}>
                All absent
              </Button>
            </div>
          }
          flush
        >
          <div className="border-b border-border/70 p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search students..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 bg-card pl-9"
              />
            </div>
          </div>

          {loading ? (
            <div className="p-4">
              <SkeletonRows count={6} height="h-12" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={Users} title="No students in this class" />
            </div>
          ) : (
            <ul className="divide-y divide-border/70">
              {visible.map((r) => {
                const changed = r.status !== r.saved;
                return (
                  <li
                    key={r.studentId}
                    className={`flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 ${
                      changed ? "bg-warning-bg/40" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">{r.name}</p>
                      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {r.indexNumber} · {r.regNumber}
                        {r.isRepeat && <span>· repeat</span>}
                        {r.savedMethod === "qr" && !changed && (
                          <span className="inline-flex items-center gap-0.5">
                            · <QrCode className="h-3 w-3" aria-hidden="true" /> signed in
                          </span>
                        )}
                        {changed && (
                          <span className="font-medium text-warning-fg">
                            · was {r.saved ?? "unmarked"}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {(
                        [
                          ["present", CheckCircle2, "Present"],
                          ["absent", XCircle, "Absent"],
                          ["excused", ShieldCheck, "Excused"],
                        ] as const
                      ).map(([value, Icon, label]) => {
                        const active = r.status === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setStatus(r.studentId, value)}
                            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                              active
                                ? value === "present"
                                  ? "bg-success-fg text-white"
                                  : value === "absent"
                                    ? "bg-danger-fg text-white"
                                    : "bg-info-fg text-white"
                                : "bg-muted text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="hidden sm:inline">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {rows.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border/70 p-3 sm:flex-row">
              <Button className="flex-1" disabled={saving || !dirty} onClick={save}>
                <Save className="mr-1.5 h-4 w-4" />
                {saving
                  ? "Saving..."
                  : dirty
                    ? `Save ${changedCount} change${changedCount === 1 ? "" : "s"}`
                    : "No changes to save"}
              </Button>
              {dirty && (
                <Button variant="outline" disabled={saving} onClick={undo}>
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  Undo changes
                </Button>
              )}
            </div>
          )}
        </SectionCard>
        <p className="px-1 text-xs text-muted-foreground">
          Tap a selected mark again to remove it. Changes appear on the
          lecturer's register as soon as they are saved.
        </p>
      </div>
    </div>
  );
}
