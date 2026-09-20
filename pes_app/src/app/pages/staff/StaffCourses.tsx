import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Users } from "lucide-react";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SegmentedTabs,
  SkeletonRows,
  StatusBadge,
} from "../../components/common";
import { useAuth } from "../../context/AuthContext";
import { describeBatch } from "../../../lib/batch";
import { formatRegNumber } from "../../../lib/format";
import {
  getMyTeaching,
  getOfferingRoster,
  type RosterStudent,
  type TeachingOffering,
} from "../../../lib/staffService";

/**
 * The courses this lecturer teaches, a batch at a time.
 *
 * Batch first, because every batch is somewhere different: one may be sitting
 * Semester 7 while another is in Semester 5, so "this semester" means nothing
 * until you say whose. Choosing a batch answers it — the page then opens on
 * that batch's current semester and lists what this lecturer teaches it now.
 *
 * Which semester a batch is in is worked out per batch from its own progress
 * (current_semester_for_batch, in the database), so a faculty holding eight
 * batches at eight different points needs no change here and no batch is
 * written into the code.
 *
 * Earlier semesters stay one choice away rather than hidden: their rosters
 * are what a repeat student, a late result, or a feedback round opened after
 * the fact are read from.
 */
export default function StaffCourses() {
  const { staff } = useAuth();
  const [offerings, setOfferings] = useState<TeachingOffering[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<number | null>(null);
  const [semester, setSemester] = useState<number | "all">("all");

  const [expanded, setExpanded] = useState<string | null>(null);
  const [rosters, setRosters] = useState<Record<string, RosterStudent[]>>({});
  const [rosterLoading, setRosterLoading] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<Record<string, string>>({});

  useEffect(() => {
    if (staff) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.lecturerId]);

  const load = async () => {
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

  const toggle = async (offering: TeachingOffering) => {
    const id = offering.offering_id;
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (rosters[id]) return;

    setRosterLoading(id);
    setRosterError((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    const result = await getOfferingRoster(id);
    if (!result.ok) {
      setRosterError((prev) => ({ ...prev, [id]: "Unable to load the roster." }));
    } else {
      setRosters((prev) => ({ ...prev, [id]: result.data }));
    }
    setRosterLoading(null);
  };

  const batches = useMemo(
    () => [...new Set(offerings.map((o) => o.batch_year))].sort((a, b) => b - a),
    [offerings],
  );

  /* Open on a batch this lecturer is teaching now; failing that, their most
     recent one. */
  useEffect(() => {
    if (batch !== null || offerings.length === 0) return;
    setBatch(offerings.find((o) => o.is_current)?.batch_year ?? batches[0]);
  }, [offerings, batches, batch]);

  const inBatch = useMemo(
    () => offerings.filter((o) => o.batch_year === batch),
    [offerings, batch],
  );

  /* Where this batch is now, and which of its semesters this lecturer has
     taught. Both come from the batch itself. */
  const batchNow = inBatch[0]?.batch_current_semester ?? null;
  const semesters = useMemo(
    () => [...new Set(inBatch.map((o) => o.semester))].sort((a, b) => a - b),
    [inBatch],
  );
  const teachesNow = batchNow !== null && semesters.includes(batchNow);

  /* Another batch is at another point in its degree, so the semester follows
     the batch rather than carrying across. */
  useEffect(() => {
    if (batch === null) return;
    setSemester(teachesNow ? (batchNow as number) : "all");
    setExpanded(null);
  }, [batch, batchNow, teachesNow]);

  const visible = inBatch.filter(
    (o) => semester === "all" || o.semester === semester,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Courses"
        description="Choose a batch to see what you are teaching it now, with the student roster."
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {batches.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedTabs
            aria-label="Batch"
            value={String(batch ?? batches[0])}
            onChange={(v) => setBatch(Number(v))}
            layoutId="staff-courses-batch"
            scrollable
            tabs={batches.map((b) => ({
              value: String(b),
              label: describeBatch(b).replace(/ \(.*\)$/, ""),
              count: offerings.filter((o) => o.batch_year === b).length,
            }))}
          />
          {semesters.length > 1 && (
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              Semester
              <select
                value={semester === "all" ? "all" : String(semester)}
                onChange={(e) =>
                  setSemester(
                    e.target.value === "all" ? "all" : Number(e.target.value),
                  )
                }
                className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
              >
                {semesters.map((s) => (
                  <option key={s} value={String(s)}>
                    Semester {s}
                    {s === batchNow ? " (Current)" : ""}
                  </option>
                ))}
                <option value="all">All semesters</option>
              </select>
            </label>
          )}
        </div>
      )}

      <SectionCard
        title={
          batch === null
            ? "Assigned offerings"
            : semester === "all"
              ? `${describeBatch(batch)} — every semester you teach it`
              : `${describeBatch(batch)} — Semester ${semester}${
                  semester === batchNow ? " (current)" : ""
                }`
        }
        description={
          batchNow !== null
            ? `${visible.length} course${visible.length === 1 ? "" : "s"} · this batch is in Semester ${batchNow} now`
            : `${visible.length} course${visible.length === 1 ? "" : "s"}`
        }
        flush
      >
        {loading ? (
          <div className="p-4">
            <SkeletonRows count={5} height="h-16" />
          </div>
        ) : offerings.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={BookOpen}
              title="No courses assigned"
              description="Your Head of Department assigns course offerings. Once that happens they appear here with the full student roster."
            />
          </div>
        ) : visible.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={BookOpen}
              title={
                teachesNow
                  ? "Nothing in this semester"
                  : `Nothing for this batch this semester`
              }
              description={
                teachesNow
                  ? "No courses match this filter. Choose another semester."
                  : `${describeBatch(batch ?? 0)} is in Semester ${
                      batchNow ?? "—"
                    } now, and you are not assigned to any of its Semester ${
                      batchNow ?? "—"
                    } courses. What you taught it before is under "All semesters"; your Head of Department assigns this semester's.`
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {visible.map((o) => {
              const open = expanded === o.offering_id;
              const roster = rosters[o.offering_id];
              return (
                <li key={o.offering_id}>
                  <button
                    type="button"
                    onClick={() => toggle(o)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      {open ? (
                        <ChevronDown className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-primary">
                            {o.course_code}
                          </span>
                          <span className="truncate text-sm text-foreground">
                            {o.course_title}
                          </span>
                          {o.my_role === "coordinator" && (
                            <StatusBadge tone="brand">Coordinator</StatusBadge>
                          )}
                          {o.is_current ? (
                            <StatusBadge tone="success">Current</StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral">Finished</StatusBadge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {describeBatch(o.batch_year)} · Semester {o.semester} ·{" "}
                          {o.academic_year} · {o.credits} credits
                        </p>
                        {o.co_lecturers.length > 0 && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Taught with{" "}
                            {o.co_lecturers
                              .map(
                                (c) =>
                                  `${c.name}${c.assignment_role === "coordinator" ? " (coordinator)" : ""}`,
                              )
                              .join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" aria-hidden="true" />
                      <span className="tabular-nums">{o.enrolled_count}</span>
                    </div>
                  </button>

                  {open && (
                    <div className="border-t border-border/70 bg-muted/20 px-4 py-3">
                      {rosterLoading === o.offering_id ? (
                        <SkeletonRows count={3} height="h-8" />
                      ) : rosterError[o.offering_id] ? (
                        <ErrorState
                          message={rosterError[o.offering_id]}
                          onRetry={() => toggle(o)}
                          size="inline"
                        />
                      ) : (roster?.length ?? 0) === 0 ? (
                        <p className="py-1 text-xs text-muted-foreground">
                          No students on this offering yet.
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border/70 text-left text-muted-foreground">
                                <th className="pb-1.5 pr-3 font-medium">Index No.</th>
                                <th className="pb-1.5 pr-3 font-medium">Name</th>
                                <th className="pb-1.5 pr-3 font-medium">Reg. No.</th>
                                <th className="pb-1.5 pr-3 font-medium">Department</th>
                                <th className="pb-1.5 font-medium">Batch</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                              {roster.map((s) => (
                                <tr key={s.student_id}>
                                  <td className="whitespace-nowrap py-1.5 pr-3 text-foreground">
                                    {s.index_number ?? "—"}
                                  </td>
                                  <td className="py-1.5 pr-3 text-foreground">
                                    <span className="flex items-center gap-1.5">
                                      {s.name}
                                      {s.is_repeat && (
                                        <StatusBadge tone="info">Repeat</StatusBadge>
                                      )}
                                    </span>
                                  </td>
                                  <td className="whitespace-nowrap py-1.5 pr-3 text-muted-foreground">
                                    {formatRegNumber(s.reg_number)}
                                  </td>
                                  <td className="py-1.5 pr-3 text-muted-foreground">
                                    {s.department}
                                  </td>
                                  <td className="whitespace-nowrap py-1.5 text-muted-foreground">
                                    {describeBatch(s.batch_year)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
