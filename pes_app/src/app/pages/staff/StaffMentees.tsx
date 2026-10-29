import { useAvatarUrls } from "../../../lib/avatars";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarX,
  ChevronRight,
  GraduationCap,
  Mail,
  MessageSquare,
  NotebookPen,
  TrendingDown,
  Users,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  CourseCode,
  DepartmentName,
  EmptyState,
  ErrorState,
  GpaTrendChart,
  PageHeader,
  PersonAvatar,
  PillTabs,
  SectionCard,
  SkeletonRows,
  StatStrip,
  StatusBadge,
} from "../../components/common";
import { useAuth } from "../../context/AuthContext";
import { describeBatch } from "../../../lib/batch";
import { MentorChat } from "../../components/mentor/MentorChat";
import { MentorNotes } from "../../components/mentor/MentorNotes";
import { MenteePlanCard } from "../../components/mentor/MenteePlanCard";
import {
  getMenteeNoteCounts,
  getMenteeOverview,
  getMenteeUnread,
  getMyMentees,
  RISK_LABEL,
  RISK_REASON,
  RISK_TONE,
  type Mentee,
  type MenteeOverview,
  type RiskBand,
} from "../../../lib/mentorService";
import { departmentRowClass } from "../../../lib/departments";

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
  const avatars = useAvatarUrls(mentees.map((m) => m.student_id));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Mentee | null>(null);
  const [batch, setBatch] = useState<number | "all">("all");
  const [band, setBand] = useState<RiskBand | "all">("all");

  /** Unread count per student, so the list says who is waiting on a reply. */
  const [unread, setUnread] = useState<Record<string, number>>({});
  /** How many notes the mentor already holds on each student. */
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [result, waiting, noted] = await Promise.all([
      getMyMentees(),
      getMenteeUnread(),
      getMenteeNoteCounts(),
    ]);
    if (!result.ok) {
      setError("We could not load your mentees. Please try again.");
      setLoading(false);
      return;
    }
    setMentees(result.data);
    if (waiting.ok) {
      setUnread(
        Object.fromEntries(waiting.data.map((w) => [w.student_id, w.unread])),
      );
    }
    if (noted.ok) {
      setNoteCounts(
        Object.fromEntries(noted.data.map((n) => [n.student_id, n.notes])),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (staff) load();
  }, [staff?.lecturerId, load]);

  /* Every batch the mentor has someone in, so the filter offers only the
     years that would actually return anybody. */
  const batches = useMemo(
    () => [...new Set(mentees.map((m) => m.batch_year))].sort((a, b) => b - a),
    [mentees],
  );

  const visible = useMemo(
    () =>
      mentees.filter(
        (m) =>
          (batch === "all" || m.batch_year === batch) &&
          (band === "all" || m.risk_band === band),
      ),
    [mentees, batch, band],
  );

  const byBatch = useMemo(() => {
    const map = new Map<number, Mentee[]>();
    visible.forEach((m) => {
      const list = map.get(m.batch_year) ?? [];
      list.push(m);
      map.set(m.batch_year, list);
    });
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [visible]);

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

      {/* The group at a glance; each chip shows just those students. */}
      {!loading && (
        <StatStrip
          items={[
            {
              label: `student${mentees.length === 1 ? "" : "s"} assigned`,
              value: mentees.length,
              icon: Users,
              tone: "brand",
              onClick: () => setBand("all"),
            },
            {
              label: "at risk · CGPA below Pass",
              value: counts.at_risk,
              icon: TrendingDown,
              tone: counts.at_risk > 0 ? "danger" : "neutral",
              onClick: counts.at_risk > 0 ? () => setBand("at_risk") : undefined,
            },
            {
              label: "need attention · failed, repeat or medical",
              value: counts.needs_attention,
              icon: AlertTriangle,
              tone: counts.needs_attention > 0 ? "warning" : "neutral",
              onClick: counts.needs_attention > 0 ? () => setBand("needs_attention") : undefined,
            },
            {
              label: "below the attendance requirement",
              value: counts.attendance_concern,
              icon: CalendarX,
              tone: counts.attendance_concern > 0 ? "info" : "neutral",
              onClick:
                counts.attendance_concern > 0 ? () => setBand("attendance_concern") : undefined,
            },
          ]}
        />
      )}

      {/* Batch first, because a mentor usually works through one year group
          at a time; then the bands, so "show me only the ones in trouble" is
          one click rather than a scroll. */}
      {!loading && mentees.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {/* A dropdown rather than a row of buttons: a mentor can hold
              students from every year in the faculty, and eight batch
              buttons pushed the bands off the line. */}
          <Select
            value={batch === "all" ? "all" : String(batch)}
            onValueChange={(v) => setBatch(v === "all" ? "all" : Number(v))}
          >
            <SelectTrigger aria-label="Batch" className="h-9 w-56 rounded-control border-border bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All batches ({mentees.length})</SelectItem>
              {batches.map((b) => (
                <SelectItem key={b} value={String(b)}>
                  {describeBatch(b)} ({mentees.filter((m) => m.batch_year === b).length})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <PillTabs
            aria-label="Show students"
            layoutId="mentees-band"
            value={band}
            onChange={(v) => setBand(v as RiskBand | "all")}
            scrollable
            tabs={[
              { value: "all", label: "Everyone" },
              ...RISK_ORDER.filter((b) => counts[b] > 0).map((b) => ({
                value: b,
                label: RISK_LABEL[b],
                count: counts[b],
              })),
            ]}
          />
        </div>
      )}

      {loading ? (
        <SkeletonRows count={4} height="h-20" />
      ) : mentees.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No students assigned to you yet"
          description="Your head of department assigns academic mentees. Once they do, your students appear here."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="Nobody matches that filter"
          description="No students in this batch carry that flag. Try another batch, or show everyone."
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
                  <li key={m.student_id} className={`transition-colors ${departmentRowClass(m.department)}`}>
                    <button
                      type="button"
                      onClick={() => setOpen(m)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <PersonAvatar name={m.name} url={avatars[m.student_id]} department={m.department} size="md" />
                        <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {m.name}
                          </span>
                          <StatusBadge tone={RISK_TONE[m.risk_band]} dot>
                            {RISK_LABEL[m.risk_band]}
                          </StatusBadge>
                          {(unread[m.student_id] ?? 0) > 0 && (
                            <StatusBadge tone="brand" icon={MessageSquare}>
                              {unread[m.student_id]} new
                            </StatusBadge>
                          )}
                          {(noteCounts[m.student_id] ?? 0) > 0 && (
                            <StatusBadge tone="neutral" icon={NotebookPen}>
                              {noteCounts[m.student_id]}
                            </StatusBadge>
                          )}
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
  const menteeAvatar = useAvatarUrls([mentee.student_id]);
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
          description={
            <>
              {mentee.index_number ?? mentee.reg_number} · {describeBatch(mentee.batch_year)} ·{" "}
              <DepartmentName department={mentee.department} />
            </>
          }
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

      {/* Above the academic detail on purpose: a mentor who opened this
          student because they wrote should not have to scroll past six
          semesters of results to answer them. */}
      <SectionCard
        title="Conversation"
        description="Only you and this student can read it."
      >
        <MentorChat studentId={mentee.student_id} otherAvatarUrl={menteeAvatar[mentee.student_id]} />
      </SectionCard>

      <SectionCard
        title="Private notes"
        description="Your own record. Nobody else can read it."
      >
        <MentorNotes studentId={mentee.student_id} canWrite />
      </SectionCard>

      {loading ? (
        <SkeletonRows count={5} height="h-16" />
      ) : !overview ? null : (
        <>
          <div className="space-y-2">
            <StatStrip
              items={[
                {
                  label: "CGPA",
                  value: overview.cgpa !== null ? overview.cgpa.toFixed(2) : "—",
                  icon: GraduationCap,
                  tone: RISK_TONE[mentee.risk_band],
                },
                {
                  label: "credits earned",
                  value: overview.credits_earned,
                  icon: Users,
                  tone: "info",
                },
                {
                  label: `outstanding · ${overview.modules.repeat} R · ${overview.modules.medical} L · ${overview.modules.failed} F`,
                  value:
                    overview.modules.repeat + overview.modules.medical + overview.modules.failed,
                  icon: AlertTriangle,
                  tone:
                    overview.modules.repeat + overview.modules.medical + overview.modules.failed > 0
                      ? "warning"
                      : "neutral",
                },
                {
                  label:
                    overview.attendance.total > 0
                      ? `attendance · ${overview.attendance.present} of ${overview.attendance.total} recorded`
                      : "attendance · nothing recorded yet",
                  value: overview.attendance.pct !== null ? `${overview.attendance.pct}%` : "—",
                  icon: CalendarX,
                },
              ]}
            />
            <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
              <StatusBadge tone={RISK_TONE[mentee.risk_band]} dot>
                {RISK_LABEL[mentee.risk_band]}
              </StatusBadge>
              {RISK_REASON[mentee.risk_band]}
            </p>
          </div>

          <MenteePlanCard studentId={mentee.student_id} />

          {/* The same SGPA chart the student sees on their own Results page,
              against their CGPA. */}
          {overview.semesters.some((s) => s.sgpa !== null) && overview.cgpa !== null ? (
            <GpaTrendChart
              title="Semester performance"
              description="SGPA for each semester with published results, against their CGPA."
              data={overview.semesters
                .filter((s) => s.sgpa !== null)
                .map((s) => ({ semester: `Sem ${s.semester}`, gpa: s.sgpa as number }))}
              cgpa={overview.cgpa}
            />
          ) : (
            <SectionCard title="Semester performance">
              <p className="text-sm text-muted-foreground">No published results yet.</p>
            </SectionCard>
          )}

          {/* Each semester's courses, the latest open and the rest a click
              away, so six semesters do not make one long scroll. */}
          {overview.semesters.map((s, i) => (
            <SectionCard
              key={s.semester}
              title={`Semester ${s.semester}`}
              description={s.academic_year ?? undefined}
              collapsible
              defaultOpen={i === overview.semesters.length - 1}
              summary={`${s.courses.length} course${s.courses.length === 1 ? "" : "s"}`}
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
                {s.courses.map((c) => {
                  /* A course sat twice appears once per attempt under the
                     same code. The grade point is what separates them: the
                     replaced attempt no longer carries one. */
                  const satTwice =
                    s.courses.filter((o) => o.course_code === c.course_code)
                      .length > 1;
                  const superseded = satTwice && c.gpv === null;
                  return (
                  <li
                    key={`${c.course_code}-${c.academic_year}`}
                    className={`flex items-center justify-between gap-3 px-4 py-2 ${
                      superseded ? "opacity-60" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <CourseCode code={c.course_code} className="text-sm" />
                      <span className="ml-2 text-sm text-foreground">
                        {c.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {c.credits} credit{c.credits === 1 ? "" : "s"}
                        {!c.contributes_to_gpa && " · not in GPA"}
                        {satTwice &&
                          ` · ${c.academic_year}${superseded ? ", replaced" : ", repeat"}`}
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
                  );
                })}
              </ul>
            </SectionCard>
          ))}
        </>
      )}
    </div>
  );
}
