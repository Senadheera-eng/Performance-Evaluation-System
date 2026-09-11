import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, UserMinus, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
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
import { useAuth } from "../../context/AuthContext";
import { describeBatch } from "../../../lib/batch";
import { getStaffCapabilities } from "../../../lib/staffScope";
import {
  assignMentor,
  clearMentor,
  getMentorAllocations,
  getMentorRoster,
  type MentorAllocation,
  type MentorRosterRow,
} from "../../../lib/mentorService";

/**
 * Mentor allocation, for the head of department.
 *
 * Two questions, so two views. "Who has nobody" is a list of students and is
 * where the work is; "who is carrying how many" is a table of lecturers and
 * is how the head keeps the load even. The unassigned come first because
 * they are the only rows that need an action.
 */
export default function HodMentors() {
  const { staff } = useAuth();
  const caps = getStaffCapabilities(staff);
  const [tab, setTab] = useState("students");
  const [roster, setRoster] = useState<MentorRosterRow[]>([]);
  const [allocations, setAllocations] = useState<MentorAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState<number | "all">("all");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [r, a] = await Promise.all([getMentorRoster(), getMentorAllocations()]);
    if (!r.ok || !a.ok) {
      setError("We could not load the mentor allocation. Please try again.");
      setLoading(false);
      return;
    }
    setRoster(r.data);
    setAllocations(a.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (staff) load();
  }, [staff?.lecturerId, load]);

  const batches = useMemo(
    () => [...new Set(roster.map((r) => r.batch_year))].sort((a, b) => b - a),
    [roster],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roster.filter((r) => {
      if (batch !== "all" && r.batch_year !== batch) return false;
      if (onlyUnassigned && r.mentor_id) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.index_number ?? "").toLowerCase().includes(q) ||
        (r.reg_number ?? "").toLowerCase().includes(q) ||
        (r.mentor_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [roster, query, batch, onlyUnassigned]);

  const unassigned = roster.filter((r) => !r.mentor_id).length;

  const act = async (
    key: string,
    run: () => Promise<{ ok: boolean; data?: { message: string }; error?: string }>,
  ) => {
    setBusy(key);
    const result = await run();
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error ?? "That did not work.");
      return;
    }
    toast.success(result.data?.message ?? "Done.");
    await load();
  };

  if (!caps.isHod) {
    return (
      <EmptyState
        icon={Users}
        title="Head of department only"
        description="Mentor allocation is managed by the head of department."
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Academic Mentors"
        description="Assign each student a lecturer who follows their whole degree."
      />

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          index={0}
          label="Students"
          value={roster.length}
          icon={Users}
          tone="brand"
        />
        <StatCard
          index={1}
          label="Without a Mentor"
          value={unassigned}
          icon={UserMinus}
          tone={unassigned > 0 ? "warning" : "success"}
        />
        <StatCard
          index={2}
          label="Mentors Active"
          value={allocations.filter((a) => a.total > 0).length}
          icon={UserPlus}
          tone="info"
        />
        <StatCard
          index={3}
          label="Lecturers Free"
          value={allocations.filter((a) => a.total === 0).length}
          icon={Users}
          tone="neutral"
          hint="No mentees yet"
        />
      </div>

      <SegmentedTabs
        tabs={[
          { value: "students", label: "Students" },
          { value: "load", label: "Mentor load" },
        ]}
        value={tab}
        onChange={setTab}
        layoutId="hod-mentor-tabs"
        aria-label="Mentor allocation view"
      />

      {tab === "load" ? (
        <SectionCard
          title="Students per mentor"
          description="How the department's mentoring is spread. A lecturer with none is free to take some."
          flush
        >
          {loading ? (
            <div className="p-4">
              <SkeletonRows count={4} height="h-12" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Mentor
                    </th>
                    {batches.map((b) => (
                      <th
                        key={b}
                        className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        {describeBatch(b)}
                      </th>
                    ))}
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((a) => (
                    <tr key={a.mentor_id} className="border-b border-border/50">
                      <td className="px-4 py-2">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-foreground">{a.mentor_name}</span>
                          {a.is_hod && (
                            <StatusBadge tone="brand">Head</StatusBadge>
                          )}
                        </span>
                      </td>
                      {batches.map((b) => (
                        <td
                          key={b}
                          className="px-3 py-2 text-center tabular-nums text-muted-foreground"
                        >
                          {a.by_batch[String(b)] ?? "—"}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right">
                        <span
                          className={`tabular-nums font-semibold ${
                            a.total === 0
                              ? "text-muted-foreground"
                              : "text-foreground"
                          }`}
                        >
                          {a.total}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, index number or mentor…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={batch === "all" ? "default" : "outline"}
                onClick={() => setBatch("all")}
              >
                All batches
              </Button>
              {batches.map((b) => (
                <Button
                  key={b}
                  size="sm"
                  variant={batch === b ? "default" : "outline"}
                  onClick={() => setBatch(b)}
                >
                  {describeBatch(b)}
                </Button>
              ))}
              <Button
                size="sm"
                variant={onlyUnassigned ? "default" : "outline"}
                onClick={() => setOnlyUnassigned(!onlyUnassigned)}
              >
                <UserMinus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Unassigned only
              </Button>
            </div>
          </div>

          <SectionCard
            title="Students"
            description={`${filtered.length} shown${unassigned > 0 ? ` · ${unassigned} still without a mentor` : ""}`}
            flush
          >
            {loading ? (
              <div className="p-4">
                <SkeletonRows count={6} height="h-14" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={Users}
                  title="No students match"
                  description="Try a different batch or clear the search."
                  size="inline"
                />
              </div>
            ) : (
              <ul className="divide-y divide-border/70">
                {filtered.map((s) => (
                  <li
                    key={s.student_id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {s.name}
                        </span>
                        {s.mentor_id ? (
                          <StatusBadge tone="success">
                            {s.mentor_name}
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="warning">No mentor</StatusBadge>
                        )}
                        {/* A student who moved into this department keeps the
                            mentor they already had. Say so, rather than leaving
                            the head to recognise an unfamiliar name. */}
                        {s.mentor_id &&
                          s.mentor_department &&
                          s.department &&
                          s.mentor_department !== s.department && (
                            <StatusBadge tone="warning">
                              mentor is in {s.mentor_department}
                            </StatusBadge>
                          )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {s.index_number ?? s.reg_number} ·{" "}
                        {describeBatch(s.batch_year)}
                        {s.cgpa !== null && ` · CGPA ${s.cgpa.toFixed(2)}`}
                      </p>
                    </div>

                    <div className="flex flex-shrink-0 items-center gap-2">
                      <select
                        className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
                        value={s.mentor_id ?? ""}
                        disabled={busy !== null}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (!next) return;
                          act(s.student_id, () =>
                            assignMentor(s.student_id, next),
                          );
                        }}
                        aria-label={`Mentor for ${s.name}`}
                      >
                        <option value="">Choose a mentor…</option>
                        {allocations.map((a) => (
                          <option key={a.mentor_id} value={a.mentor_id}>
                            {a.mentor_name} ({a.total})
                          </option>
                        ))}
                      </select>
                      {s.mentor_id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null}
                          onClick={() =>
                            act(s.student_id, () => clearMentor(s.student_id))
                          }
                          aria-label={`Remove ${s.name}'s mentor`}
                        >
                          <UserMinus className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
