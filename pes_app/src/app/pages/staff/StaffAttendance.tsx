import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Save,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SkeletonRows,
  StatCard,
  StatusBadge,
} from "../../components/common";
import { OfferingPicker } from "../../components/staff/OfferingPicker";
import { LectureRegister } from "../../components/attendance/LectureRegister";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { describeBatch } from "../../../lib/batch";
import { formatRegNumber } from "../../../lib/format";
import { useSettings } from "../../../lib/settings";
import {
  classifyTier,
  percentageOf,
  totalCount,
  TIER_LABEL,
  type AttendanceCounts,
} from "../../../lib/attendanceMath";
import { TIER_TONE } from "../../components/attendance/AttendanceOverview";
import {
  localDateISO,
  OWN_WRITE_ECHO_MS,
  useAttendanceLive,
} from "../../../lib/attendanceRegister";
import {
  getMyTeaching,
  getOfferingAttendance,
  getOfferingRoster,
  saveOfferingAttendance,
  type AttendanceRow,
  type AttendanceStatus,
  type TeachingOffering,
} from "../../../lib/staffService";

interface Row {
  studentId: string;
  name: string;
  indexNumber: string;
  regNumber: string;
  /** Mark for the date being edited, or null when not yet marked. */
  status: AttendanceStatus | null;
  /** Running totals across every recorded lecture, for context. */
  counts: AttendanceCounts;
}

/* The lecturer's own calendar day. toISOString() is the UTC date, which in
   Sri Lanka is still yesterday until 5:30 in the morning. */
const today = () => localDateISO();

export default function StaffAttendance() {
  const { student, staff } = useAuth();
  const settings = useSettings();
  const threshold = settings.attendanceThreshold;
  const prewarning = settings.attendancePrewarningThreshold;

  const [offerings, setOfferings] = useState<TeachingOffering[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<Row[]>([]);
  const [recordedDates, setRecordedDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /* Kept for the unsaved-changes hint below the roster; it no longer gates
     the Save button. */
  const [dirty, setDirty] = useState(false);
  /* Registers left open on any course this lecturer teaches. A forgotten one
     holds check-ins that never became attendance, and nothing else was ever
     going to mention it. */
  const [unclosed, setUnclosed] = useState<
    { session_id: string; offering_id: string; course_code: string;
      lecture_date: string; checked_in: number; window_passed: boolean }[]
  >([]);

  const selected = offerings.find((o) => o.offering_id === selectedId) ?? null;

  useEffect(() => {
    if (staff) loadOfferings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.lecturerId]);

  useEffect(() => {
    if (selectedId) loadSheet(selectedId, date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, date]);

  const loadUnclosed = async () => {
    const { data } = await supabase.rpc("my_unclosed_registers");
    setUnclosed((data ?? []) as typeof unclosed);
  };

  useEffect(() => {
    if (staff) loadUnclosed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.lecturerId, selectedId]);

  const loadOfferings = async () => {
    setLoading(true);
    setError(null);
    const result = await getMyTeaching();
    if (!result.ok) {
      setError("We could not load your courses. Please try again.");
      setLoading(false);
      return;
    }
    setOfferings(result.data);
    setLoading(false);
  };

  const loadSheet = async (offeringId: string, lectureDate: string) => {
    setSheetLoading(true);
    setError(null);
    setNotice(null);
    setDirty(false);

    const [roster, attendance] = await Promise.all([
      getOfferingRoster(offeringId),
      getOfferingAttendance(offeringId),
    ]);

    if (!roster.ok) {
      setError("We could not load the class list for this course.");
      setRows([]);
      setSheetLoading(false);
      return;
    }
    if (!attendance.ok) {
      setError("We could not load the attendance records for this course.");
      setRows([]);
      setSheetLoading(false);
      return;
    }

    // Running totals per student across every recorded lecture, so the
    // lecturer marking today can see who is already at risk.
    const totals = new Map<string, AttendanceCounts>();
    const onDate = new Map<string, AttendanceStatus>();
    for (const a of attendance.data as AttendanceRow[]) {
      const cur = totals.get(a.student_id) ?? { present: 0, absent: 0, excused: 0 };
      cur[a.status] += 1;
      totals.set(a.student_id, cur);
      if (a.lecture_date === lectureDate) onDate.set(a.student_id, a.status);
    }

    setRecordedDates(
      [...new Set(attendance.data.map((a) => a.lecture_date))].sort().reverse(),
    );

    setRows(
      roster.data.map((s) => ({
        studentId: s.student_id,
        name: s.name,
        indexNumber: s.index_number ?? "—",
        regNumber: formatRegNumber(s.reg_number),
        status: onDate.get(s.student_id) ?? null,
        counts: totals.get(s.student_id) ?? { present: 0, absent: 0, excused: 0 },
      })),
    );
    setSheetLoading(false);
  };

  const setStatus = (studentId: string, status: AttendanceStatus) => {
    setRows((prev) =>
      prev.map((r) =>
        r.studentId === studentId
          ? { ...r, status: r.status === status ? null : status }
          : r,
      ),
    );
    setDirty(true);
  };

  const markAll = (status: AttendanceStatus) => {
    setRows((prev) => prev.map((r) => ({ ...r, status })));
    setDirty(true);
  };

  /* The office corrects registers too, and a register closing writes marks
     while this page is open. Pull those in as they happen — unless the
     lecturer is part-way through marking, when a reload would throw their
     work away; then say so and let them choose. */
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  /* This page's own save comes back as change events too, and one can land
     before the sheet has reloaded — it must not be mistaken for someone
     else's edit. */
  const ownWriteAt = useRef(0);
  useAttendanceLive(selected?.offering_id ?? null, () => {
    if (!selected) return;
    if (saving || Date.now() - ownWriteAt.current < OWN_WRITE_ECHO_MS) return;
    if (dirty) setChangedElsewhere(true);
    else loadSheet(selected.offering_id, date);
  });
  useEffect(() => setChangedElsewhere(false), [selectedId, date]);

  const handleSave = async () => {
    if (!selected) return;
    const marked = rows.filter((r) => r.status !== null);
    ownWriteAt.current = Date.now();
    setSaving(true);
    setError(null);
    setNotice(null);

    const result = await saveOfferingAttendance(
      selected.offering_id,
      selected.course_id,
      date,
      marked.map((r) => ({ student_id: r.studentId, status: r.status! })),
      student?.id ?? "",
    );

    ownWriteAt.current = Date.now();
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Reload first. loadSheet clears the notice as it starts, so setting the
    // message before it meant the save confirmation was wiped a moment after
    // it appeared — the button looked like it had done nothing at all.
    await loadSheet(selected.offering_id, date);
    setNotice(`Attendance saved for ${result.data} student(s) on ${date}.`);
  };

  const present = rows.filter((r) => r.status === "present").length;
  const absent = rows.filter((r) => r.status === "absent").length;
  const excused = rows.filter((r) => r.status === "excused").length;
  const unmarked = rows.filter((r) => r.status === null).length;
  const alreadyRecorded = recordedDates.includes(date);

  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.name.toLowerCase().includes(query.toLowerCase()) ||
          r.indexNumber.toLowerCase().includes(query.toLowerCase()) ||
          r.regNumber.toLowerCase().includes(query.toLowerCase()),
      ),
    [rows, query],
  );

  if (!loading && offerings.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="Attendance" />
        <EmptyState
          icon={Calendar}
          title="No courses assigned"
          description="Attendance marking appears here once your Head of Department assigns you to a course offering."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Attendance"
        description={`Mark a lecture for a course you teach. Students need ${threshold}% to sit the end-of-semester examination.`}
      />

      {error && <ErrorState message={error} size="inline" />}
      {changedElsewhere && selected && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-sm text-warning-fg">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span className="flex-1">
            Someone else just changed attendance for this course. Reload to see
            it — your unsaved marks will be lost.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setChangedElsewhere(false);
              loadSheet(selected.offering_id, date);
            }}
          >
            Reload
          </Button>
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2 text-sm text-success-fg">
          {notice}
        </div>
      )}

      <SectionCard title="Batch, course & lecture date">
        {loading ? (
          <SkeletonRows count={1} height="h-10" />
        ) : (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <OfferingPicker
                offerings={offerings}
                value={selectedId}
                onChange={setSelectedId}
              />
            </div>
            <label className="flex flex-col gap-1 lg:w-48">
              <span className="text-xs font-medium text-muted-foreground">
                Lecture date
              </span>
              <Input
                type="date"
                value={date}
                max={today()}
                onChange={(e) => setDate(e.target.value)}
                className="h-10 bg-card"
                aria-label="Lecture date"
              />
            </label>
          </div>
        )}
        {alreadyRecorded && (
          <p className="mt-2 text-xs text-muted-foreground">
            This date already has attendance recorded — saving updates it rather
            than adding a second record.
          </p>
        )}
        {recordedDates.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {recordedDates.length} lecture{recordedDates.length === 1 ? "" : "s"}{" "}
            recorded so far. Most recent: {recordedDates[0]}.
          </p>
        )}
      </SectionCard>

      {unclosed.filter((u) => u.offering_id !== selectedId).length > 0 && (
        <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-sm text-warning-fg">
          <p className="font-medium">
            You have a register still open on another course.
          </p>
          <p className="mt-0.5 text-xs">
            Its check-ins have not been recorded as attendance yet. Select the
            course to pick it up and close it.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {unclosed
              .filter((u) => u.offering_id !== selectedId)
              .map((u) => (
                <button
                  key={u.session_id}
                  type="button"
                  onClick={() => setSelectedId(u.offering_id)}
                  className="rounded-full border border-warning-border bg-card px-2.5 py-1 text-xs font-medium hover:bg-muted"
                >
                  {u.course_code} · {u.lecture_date} · {u.checked_in} signed in
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Sits above the roster on purpose: opening the register is the first
          thing that happens in a lecture, and marking by hand is what is left
          over once it closes. */}
      {selected && (
        <LectureRegister
          offeringId={selected.offering_id}
          courseLabel={selected.course_code}
          lectureDate={date}
          onClosed={() => loadSheet(selected.offering_id, date)}
        />
      )}

      {selected && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard index={0} label="Present" value={present} icon={CheckCircle2} tone="success" />
            <StatCard index={1} label="Absent" value={absent} icon={XCircle} tone="danger" />
            <StatCard index={2} label="Excused" value={excused} icon={ShieldCheck} tone="info" />
            <StatCard
              index={3}
              label="Unmarked"
              value={unmarked}
              icon={AlertTriangle}
              tone={unmarked > 0 ? "warning" : "success"}
            />
          </div>

          <SectionCard
            title={`${selected.course_code} — ${selected.course_title} · ${describeBatch(selected.batch_year)}`}
            description={`${rows.length} students · ${date}`}
            actions={
              <div className="flex gap-2">
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

            {sheetLoading ? (
              <div className="p-4">
                <SkeletonRows count={6} height="h-12" />
              </div>
            ) : visible.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={Calendar}
                  title={query ? "No students match that search" : "No students on this offering"}
                />
              </div>
            ) : (
              <ul className="divide-y divide-border/70">
                {visible.map((r) => {
                  const total = totalCount(r.counts);
                  const pct = percentageOf(r.counts);
                  const tier = classifyTier(pct, total, threshold, prewarning);
                  return (
                    <li
                      key={r.studentId}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-foreground">{r.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.indexNumber} · {r.regNumber}
                          {total > 0 && (
                            <>
                              {" · "}
                              <span
                                className={
                                  pct < threshold ? "text-danger-fg" : undefined
                                }
                              >
                                {pct}% over {total} lecture{total === 1 ? "" : "s"}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {total > 0 && tier !== "pending" && (
                          <StatusBadge tone={TIER_TONE[tier]} className="hidden sm:inline-flex">
                            {TIER_LABEL[tier]}
                          </StatusBadge>
                        )}
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
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {rows.length > 0 && (
              <div className="border-t border-border/70 p-3">
                {/* Enabled whenever there is something to save, changed or
                    not. Gating on "has anything changed" was an optimisation,
                    not a rule, and it made the button look broken every time a
                    register filled the sheet: forty names marked and Save
                    dead. Saving the same values again is a harmless upsert. */}
                <Button
                  className="w-full"
                  disabled={saving || rows.every((r) => r.status === null)}
                  onClick={handleSave}
                >
                  <Save className="mr-1.5 h-4 w-4" />
                  {saving
                    ? "Saving..."
                    : `Save attendance (${rows.length - unmarked} marked)`}
                </Button>
                {dirty && (
                  <p className="mt-2 text-center text-xs text-warning-fg">
                    You have unsaved changes on this sheet.
                  </p>
                )}
                {unmarked > 0 && (
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    {unmarked} student{unmarked === 1 ? "" : "s"} left unmarked —
                    they will have no record for this date.
                  </p>
                )}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
