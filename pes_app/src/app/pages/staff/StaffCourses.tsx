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
import { Button } from "../../components/ui/button";
import { useAuth } from "../../context/AuthContext";
import { describeBatch } from "../../../lib/batch";
import { formatRegNumber } from "../../../lib/format";
import {
  getMyTeaching,
  getOfferingRoster,
  type RosterStudent,
  type TeachingOffering,
} from "../../../lib/staffService";

type Period = "current" | "earlier" | "all";

/**
 * The courses this lecturer teaches.
 *
 * "This semester" first, and by default only that. An offering is a course
 * as delivered to one batch in one year, so a lecturer who has taught the
 * same batch since their second year accumulates every past delivery — for
 * Batch 7, now in Semester 7, that was Semester 5 and 6 classes finished two
 * years ago listed as though they were still running. Earlier deliveries are
 * one click away rather than gone: their rosters still matter for a repeat
 * student, a late result, or a feedback round opened after the fact.
 */
export default function StaffCourses() {
  const { staff } = useAuth();
  const [offerings, setOfferings] = useState<TeachingOffering[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batchFilter, setBatchFilter] = useState<string>("all");
  const [period, setPeriod] = useState<Period>("current");

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

  const currentCount = offerings.filter((o) => o.is_current).length;

  const visible = offerings.filter(
    (o) =>
      (batchFilter === "all" || o.batch_year === Number(batchFilter)) &&
      (period === "all" || (period === "current" ? o.is_current : !o.is_current)),
  );

  /* What the batch is sitting now, for the empty state. Every offering of a
     batch carries the same answer, so any of them will do. */
  const batchNow = offerings.find(
    (o) => batchFilter !== "all" && o.batch_year === Number(batchFilter),
  )?.batch_current_semester;

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Courses"
        description="The course offerings you are assigned to teach, with their student rosters."
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {offerings.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedTabs
            aria-label="Filter by when the course runs"
            value={period}
            onChange={(v) => setPeriod(v as Period)}
            layoutId="staff-courses-period"
            tabs={[
              { value: "current", label: "This semester", count: currentCount },
              {
                value: "earlier",
                label: "Earlier",
                count: offerings.length - currentCount,
              },
              { value: "all", label: "All", count: offerings.length },
            ]}
          />
          {batches.length > 1 && (
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              Batch
              <select
                value={batchFilter}
                onChange={(e) => setBatchFilter(e.target.value)}
                className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
              >
                <option value="all">All batches</option>
                {batches.map((b) => (
                  <option key={b} value={String(b)}>
                    {describeBatch(b)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <SectionCard
        title={
          period === "current"
            ? "Teaching this semester"
            : period === "earlier"
              ? "Earlier semesters"
              : "All assigned offerings"
        }
        description={`${visible.length} offering${visible.length === 1 ? "" : "s"}`}
        flush
      >
        {loading ? (
          <div className="p-4">
            <SkeletonRows count={5} height="h-16" />
          </div>
        ) : visible.length === 0 ? (
          <div className="p-4">
            {offerings.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="No courses assigned"
                description="Your Head of Department assigns course offerings. Once that happens they appear here with the full student roster."
              />
            ) : period === "current" ? (
              /* Assigned, but only to deliveries that have finished. Said
                 plainly: the alternative is a lecturer staring at an empty
                 page wondering which half is broken. */
              <EmptyState
                icon={BookOpen}
                title="Nothing to teach this semester"
                description={`You are not assigned to any course running this semester${
                  batchNow ? ` (${describeBatch(Number(batchFilter))} is now in Semester ${batchNow})` : ""
                }. Your earlier courses are under "Earlier" — your Head of Department assigns this semester's.`}
                action={
                  <Button variant="outline" onClick={() => setPeriod("earlier")}>
                    See earlier courses
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={BookOpen}
                title="Nothing here"
                description="No offerings match this filter."
              />
            )}
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
                            <StatusBadge tone="success">This semester</StatusBadge>
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
