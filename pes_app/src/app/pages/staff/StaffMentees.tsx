import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarX,
  ChevronRight,
  GraduationCap,
  Mail,
  TrendingDown,
  Users,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SkeletonRows,
  StatCard,
  StatusBadge,
} from "../../components/common";
import { useAuth } from "../../context/AuthContext";
import { describeBatch } from "../../../lib/batch";
import {
  getMenteeOverview,
  getMyMentees,
  RISK_LABEL,
  RISK_REASON,
  RISK_TONE,
  type Mentee,
  type MenteeOverview,
  type RiskBand,
} from "../../../lib/mentorService";

/** Worst first: the order a mentor would want to work down the list in. */
const RISK_ORDER: RiskBand[] = [
  "at_risk",
  "needs_attention",
  "attendance_concern",
  "good",
];

/**
 * A lecturer's mentees.
 *
 * A mentor watches a whole degree rather than one course of it, so this page
 * leads with the students who need a conversation instead of an alphabetical
 * roll. The bands come from the database, which reads them from the faculty's
 * own thresholds — this page only says what it was told.
 *
 * Opening a student replaces the list rather than expanding a row. A mentor
 * reading one student's six semesters is doing something different from
 * scanning the group, and the two do not belong on screen at once.
 */
export default function StaffMentees() {
  const { staff } = useAuth();
  const [mentees, setMentees] = useState<Mentee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Mentee | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getMyMentees();
    if (!result.ok) {
      setError("We could not load your mentees. Please try again.");
      setLoading(false);
      return;
    }
    setMentees(result.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (staff) load();
  }, [staff?.lecturerId, load]);

  const byBatch = useMemo(() => {
    const map = new Map<number, Mentee[]>();
    mentees.forEach((m) => {
      const list = map.get(m.batch_year) ?? [];
      list.push(m);
      map.set(m.batch_year, list);
    });
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [mentees]);

  const counts = useMemo(() => {
    const c: Record<RiskBand, number> = {
      at_risk: 0,
      needs_attention: 0,
      attendance_concern: 0,
      good: 0,
    };
    mentees.forEach((m) => (c[m.risk_band] += 1));
    return c;
  }, [mentees]);

  if (open) {
    return (
      <MenteeDetail mentee={open} onBack={() => setOpen(null)} />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Academic Mentoring"
        description="The students assigned to you, and how their degrees are going."
      />

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          index={0}
          label="Students Assigned"
          value={mentees.length}
          icon={Users}
          tone="brand"
        />
        <StatCard
          index={1}
          label="At Risk"
          value={counts.at_risk}
          icon={TrendingDown}
          tone={counts.at_risk > 0 ? "danger" : "neutral"}
          hint="CGPA below Pass"
        />
        <StatCard
          index={2}
          label="Needs Attention"
          value={counts.needs_attention}
          icon={AlertTriangle}
          tone={counts.needs_attention > 0 ? "warning" : "neutral"}
          hint="Failed, repeat or medical"
        />
        <StatCard
          index={3}
          label="Attendance Concern"
          value={counts.attendance_concern}
          icon={CalendarX}
          tone={counts.attendance_concern > 0 ? "info" : "neutral"}
        />
      </div>

      {loading ? (
        <SkeletonRows count={4} height="h-20" />
      ) : mentees.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No students assigned to you yet"
          description="Your head of department assigns academic mentees. Once they do, your students appear here."
        />
      ) : (
        byBatch.map(([batch, list]) => (
          <SectionCard
            key={batch}
            title={describeBatch(batch)}
            description={`${list.length} student${list.length === 1 ? "" : "s"} assigned`}
            flush
          >
            <ul className="divide-y divide-border/70">
              {[...list]
                .sort(
                  (a, b) =>
                    RISK_ORDER.indexOf(a.risk_band) -
                      RISK_ORDER.indexOf(b.risk_band) ||
                    (a.index_number ?? "").localeCompare(b.index_number ?? ""),
                )
                .map((m) => (
                  <li key={m.student_id}>
                    <button
                      type="button"
                      onClick={() => setOpen(m)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {m.name}
                          </span>
                          <StatusBadge tone={RISK_TONE[m.risk_band]} dot>
                            {RISK_LABEL[m.risk_band]}
                          </StatusBadge>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {m.index_number ?? m.reg_number} · Semester{" "}
                          {m.latest_semester} ·{" "}
                          {m.cgpa !== null ? `CGPA ${m.cgpa.toFixed(2)}` : "no results yet"}
                          {m.modules_repeat + m.modules_medical + m.modules_failed >
                            0 &&
                            ` · ${m.modules_repeat + m.modules_medical + m.modules_failed} module${
                              m.modules_repeat + m.modules_medical + m.modules_failed === 1
                                ? ""
                                : "s"
                            } outstanding`}
                        </p>
                      </div>
                      <ChevronRight
                        className="h-4 w-4 flex-shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                ))}
            </ul>
          </SectionCard>
        ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One student's degree                                                */
/* ------------------------------------------------------------------ */

function MenteeDetail({
  mentee,
  onBack,
}: {
  mentee: Mentee;
  onBack: () => void;
}) {
  const [overview, setOverview] = useState<MenteeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getMenteeOverview(mentee.student_id);
    if (!result.ok) setError(result.error);
    else {
      setError(null);
      setOverview(result.data);
    }
    setLoading(false);
  }, [mentee.student_id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-2">
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
          All mentees
        </Button>
        <PageHeader
          title={mentee.name}
          description={`${mentee.index_number ?? mentee.reg_number} · ${describeBatch(mentee.batch_year)} · ${mentee.department}`}
          actions={
            <Button variant="outline" size="sm" asChild>
              <a href={`mailto:${mentee.email}`}>
                <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Email
              </a>
            </Button>
          }
        />
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      {loading ? (
        <SkeletonRows count={5} height="h-16" />
      ) : !overview ? null : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              index={0}
              label="CGPA"
              value={overview.cgpa !== null ? overview.cgpa.toFixed(2) : "—"}
              icon={GraduationCap}
              tone={RISK_TONE[mentee.risk_band]}
              hint={RISK_REASON[mentee.risk_band]}
            />
            <StatCard
              index={1}
              label="Credits Earned"
              value={overview.credits_earned}
              icon={Users}
              tone="info"
            />
            <StatCard
              index={2}
              label="Outstanding Modules"
              value={
                overview.modules.repeat +
                overview.modules.medical +
                overview.modules.failed
              }
              icon={AlertTriangle}
              tone={
                overview.modules.repeat +
                  overview.modules.medical +
                  overview.modules.failed >
                0
                  ? "warning"
                  : "neutral"
              }
              hint={`${overview.modules.repeat} R · ${overview.modules.medical} L · ${overview.modules.failed} F`}
            />
            <StatCard
              index={3}
              label="Attendance"
              value={
                overview.attendance.pct !== null
                  ? `${overview.attendance.pct}%`
                  : "—"
              }
              icon={CalendarX}
              tone="neutral"
              hint={
                overview.attendance.total > 0
                  ? `${overview.attendance.present} of ${overview.attendance.total} recorded`
                  : "nothing recorded yet"
              }
            />
          </div>

          <SectionCard
            title="Semester performance"
            description="SGPA for each semester with published results."
          >
            {overview.semesters.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No published results yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex min-w-max items-end gap-2">
                  {overview.semesters.map((s) => (
                    <div
                      key={s.semester}
                      className="flex w-20 flex-col items-center gap-1"
                    >
                      <span className="text-xs font-semibold tabular-nums text-foreground">
                        {s.sgpa !== null ? s.sgpa.toFixed(2) : "—"}
                      </span>
                      <span
                        className="w-full rounded-t bg-primary/80"
                        style={{
                          height: `${Math.max(4, ((s.sgpa ?? 0) / 4) * 90)}px`,
                        }}
                        aria-hidden="true"
                      />
                      <span className="text-[11px] text-muted-foreground">
                        Sem {s.semester}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SectionCard>

          {overview.semesters.map((s) => (
            <SectionCard
              key={s.semester}
              title={`Semester ${s.semester}`}
              description={s.academic_year ?? undefined}
              actions={
                s.sgpa !== null ? (
                  <StatusBadge tone={s.sgpa >= 3 ? "success" : s.sgpa >= 2 ? "info" : "danger"}>
                    SGPA {s.sgpa.toFixed(2)}
                  </StatusBadge>
                ) : undefined
              }
              flush
            >
              <ul className="divide-y divide-border/70">
                {s.courses.map((c) => (
                  <li
                    key={c.course_code}
                    className="flex items-center justify-between gap-3 px-4 py-2"
                  >
                    <span className="min-w-0">
                      <span className="text-sm font-semibold text-primary">
                        {c.course_code}
                      </span>
                      <span className="ml-2 text-sm text-foreground">
                        {c.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {c.credits} credit{c.credits === 1 ? "" : "s"}
                        {!c.contributes_to_gpa && " · not in GPA"}
                      </span>
                    </span>
                    <StatusBadge
                      tone={
                        c.grade === null
                          ? "neutral"
                          : ["R", "L", "F"].includes(c.grade)
                            ? "danger"
                            : "success"
                      }
                    >
                      {c.grade ?? "—"}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ))}
        </>
      )}
    </div>
  );
}
