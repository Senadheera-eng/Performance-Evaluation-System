import { useAvatarUrls } from "../../../lib/avatars";
import { useCallback, useEffect, useMemo, useState } from "react";
import { UserMinus, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import {
  AnimatedBar,
  PersonAvatar,
  EmptyState,
  ErrorState,
  PageHeader,
  PillTabs,
  SearchField,
  SectionCard,
  SkeletonRows,
  StatStrip,
  StatusBadge,
  TabPanel,
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
import { departmentRowClass } from "../../../lib/departments";

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
  const avatars = useAvatarUrls(roster.map((r) => r.student_id));
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
  const maxLoad = Math.max(1, ...allocations.map((a) => a.total));

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

      {!loading && (
        <StatStrip
          items={[
            { label: "students", value: roster.length, icon: Users, tone: "brand" },
            {
              label: "without a mentor",
              value: unassigned,
              icon: UserMinus,
              tone: unassigned > 0 ? "warning" : "success",
              // Straight to the students who need one.
              onClick:
                unassigned > 0
                  ? () => {
                      setTab("students");
                      setOnlyUnassigned(true);
                    }
                  : undefined,
            },
            {
              label: "mentors active",
              value: allocations.filter((a) => a.total > 0).length,
              icon: UserPlus,
              tone: "info",
            },
            {
              label: "lecturers with no mentees yet",
              value: allocations.filter((a) => a.total === 0).length,
              icon: Users,
            },
          ]}
        />
      )}

      <PillTabs
        tabs={[
          { value: "students", label: "Students", count: roster.length },
          { value: "load", label: "Mentor load", count: allocations.length },
        ]}
        value={tab}
        onChange={setTab}
        layoutId="hod-mentor-tabs"
        aria-label="Mentor allocation view"
      />

      <TabPanel value={tab}>
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
                        <td className="px-4 py-2">
                          {/* The load against the busiest mentor, so an
                              uneven spread reads down the column. */}
                          <span className="flex items-center justify-end gap-3">
                            <AnimatedBar
                              value={a.total}
                              max={maxLoad}
                              tone="info"
                              label={`${a.mentor_name}: ${a.total} mentees`}
                              className="hidden h-1.5 w-24 sm:block"
                            />
                            <span
                              className={`w-6 text-right tabular-nums font-semibold ${
                                a.total === 0
                                  ? "text-muted-foreground"
                                  : "text-foreground"
                              }`}
                            >
                              {a.total}
                            </span>
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
            {/* One row of controls: search, batch, and the students still
                without anyone. */}
            <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
              <SearchField
                value={query}
                onChange={setQuery}
                placeholder="Search by name, index number or mentor"
                label="Search students"
              />
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={batch === "all" ? "all" : String(batch)}
                  onValueChange={(v) => setBatch(v === "all" ? "all" : Number(v))}
                >
                  <SelectTrigger aria-label="Batch" className="h-9 w-56 rounded-control border-border bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All batches</SelectItem>
                    {batches.map((b) => (
                      <SelectItem key={b} value={String(b)}>
                        {describeBatch(b)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <Switch checked={onlyUnassigned} onCheckedChange={setOnlyUnassigned} />
                  Unassigned only{unassigned > 0 ? ` (${unassigned})` : ""}
                </label>
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
                      className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors ${departmentRowClass(s.department)}`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                      <PersonAvatar name={s.name} url={avatars[s.student_id]} department={s.department} size="sm" />
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
                      </div>

                      <div className="flex flex-shrink-0 items-center gap-2">
                        <Select
                          value={s.mentor_id ?? undefined}
                          disabled={busy !== null}
                          onValueChange={(next) =>
                            act(s.student_id, () => assignMentor(s.student_id, next))
                          }
                        >
                          <SelectTrigger
                            aria-label={`Mentor for ${s.name}`}
                            className="h-9 w-60 rounded-control border-border bg-card"
                          >
                            <SelectValue placeholder="Choose a mentor…" />
                          </SelectTrigger>
                          <SelectContent>
                            {allocations.map((a) => (
                              <SelectItem key={a.mentor_id} value={a.mentor_id}>
                                {a.mentor_name} ({a.total})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
      </TabPanel>
    </div>
  );
}
