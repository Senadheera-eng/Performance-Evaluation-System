import { useCallback, useEffect, useState } from "react";
import { Check, ClipboardList, GraduationCap, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  EmptyState,
  ErrorState,
  SectionCard,
  SkeletonRows,
  StatusBadge,
} from "../common";
import {
  addMinor,
  deleteMinor,
  renameMinor,
  setMinorCredits,
} from "../../../lib/minors";
import {
  getDepartmentMinorPlan,
  minorTitle,
  planSemesters,
  type MinorPlan,
} from "../../../lib/minorPlan";
import { MinorPlanTable } from "../minors/MinorPlanTable";
import { MinorPlanEditor } from "../minors/MinorPlanEditor";

/**
 * A department's minor specialisations, managed in one place.
 *
 * The handbook names the streams but prints no credit total for them — it
 * says only that a minor is claimed after "an approved combination of
 * Courses", made known to students in advance. That approval is the
 * department's, so the number is set here rather than guessed once in a
 * migration and then quietly wrong for four years.
 *
 * Each minor's study plan is set out here too, as the table students see at
 * enrolment: per semester, a mandatory basket and an elective basket with a
 * minimum number of credits. "Edit study plan" changes it; nothing about a
 * minor is fixed in the pages, so a revised plan from the faculty is entered
 * here rather than coded. Renaming a minor carries its plan and its course
 * tags with it, in a single database call.
 */
export function MinorSpecifications({
  department,
  canWrite,
}: {
  department: string;
  /** False for a reader — the lists still show, the controls do not. */
  canWrite: boolean;
}) {
  const [minors, setMinors] = useState<MinorPlan[]>([]);
  const [editingPlan, setEditingPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newCredits, setNewCredits] = useState(5);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [credits, setCredits] = useState<Record<string, number>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!department) return;
    setLoading(true);
    const result = await getDepartmentMinorPlan(department);
    if (!result.ok) {
      setError(result.error);
    } else {
      setError(null);
      setMinors(result.data);
      setCredits(
        Object.fromEntries(result.data.map((m) => [m.minor, m.required_credits])),
      );
    }
    setLoading(false);
  }, [department]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (
    key: string,
    action: () => Promise<{ ok: boolean; error?: string; data?: unknown }>,
    fallback: string,
  ) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? "That did not work. Please try again.");
      return;
    }
    await load();
    setNotice(typeof result.data === "string" ? result.data : fallback);
  };

  if (!department) {
    return (
      <SectionCard title="Minor specialisations">
        <p className="text-sm text-muted-foreground">
          No department to manage minors for.
        </p>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      {notice && (
        <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2 text-sm text-success-fg">
          {notice}
        </div>
      )}
      {error && <ErrorState message={error} size="inline" onRetry={load} />}

      <SectionCard
        title="Minor specialisations"
        description={`Which minors ${department} offers, the credits that claim each, and its study plan — the table students see when they enrol.`}
        flush
      >
        {loading ? (
          <div className="p-4">
            <SkeletonRows count={3} height="h-16" />
          </div>
        ) : minors.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={GraduationCap}
              title="No minors yet"
              description={
                canWrite
                  ? "Add a minor below, then set out its study plan."
                  : "This department has not set up any minor specialisations."
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {minors.map((m) => {
              const semesters = planSemesters(m);
              const courseCount = new Set(
                m.baskets.flatMap((b) => b.courses.map((c) => c.course_id)),
              ).size;
              const minimums = m.baskets.reduce((n, b) => n + b.min_credits, 0);
              const short = minimums < m.required_credits;
              return (
                <li key={m.minor} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {renaming === m.minor ? (
                      <div className="flex flex-1 flex-wrap items-center gap-2">
                        <Input
                          value={renameTo}
                          onChange={(e) => setRenameTo(e.target.value)}
                          className="h-9 max-w-xs"
                          aria-label={`New name for ${m.minor}`}
                        />
                        <Button
                          size="sm"
                          disabled={busy !== null || !renameTo.trim()}
                          onClick={async () => {
                            await run(
                              m.minor,
                              () => renameMinor(department, m.minor, renameTo),
                              "Renamed.",
                            );
                            setRenaming(null);
                          }}
                        >
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                          Save name
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRenaming(null)}
                        >
                          <X className="mr-1.5 h-3.5 w-3.5" />
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                          <GraduationCap
                            className="h-4 w-4 text-muted-foreground"
                            aria-hidden="true"
                          />
                          {m.minor}
                          <StatusBadge tone={short ? "warning" : "success"}>
                            {m.baskets.length === 0
                              ? "No study plan yet"
                              : `Semesters ${semesters[0]}–${semesters[semesters.length - 1]} · ${courseCount} course${courseCount === 1 ? "" : "s"} · ${m.required_credits} credits`}
                          </StatusBadge>
                        </p>
                        {short && m.baskets.length > 0 && (
                          /* Not an error: a plan can be short while it is
                             still being entered. Worth saying, because a
                             student cannot claim the minor either way. */
                          <p className="mt-1 text-xs text-warning-fg">
                            The baskets' minimums add up to {minimums} — fewer than the{" "}
                            {m.required_credits} credits the minor requires.
                          </p>
                        )}
                      </div>
                    )}

                    {canWrite && renaming !== m.minor && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          value={credits[m.minor] ?? m.required_credits}
                          onChange={(e) =>
                            setCredits((prev) => ({
                              ...prev,
                              [m.minor]: Number(e.target.value),
                            }))
                          }
                          className="h-9 w-20"
                          aria-label={`Credits required for ${m.minor}`}
                        />
                        <span className="text-xs text-muted-foreground">credits</span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            busy !== null ||
                            (credits[m.minor] ?? m.required_credits) ===
                              m.required_credits
                          }
                          onClick={() =>
                            run(
                              m.minor,
                              () =>
                                setMinorCredits(
                                  department,
                                  m.minor,
                                  credits[m.minor] ?? m.required_credits,
                                ),
                              "Credits saved.",
                            )
                          }
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => {
                            setRenaming(m.minor);
                            setRenameTo(m.minor);
                          }}
                        >
                          <Pencil className="mr-1.5 h-3.5 w-3.5" />
                          Rename
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive"
                          disabled={busy !== null}
                          onClick={() => setConfirmDelete(m.minor)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="sr-only">Remove {m.minor}</span>
                        </Button>
                      </div>
                    )}
                  </div>

                  {confirmDelete === m.minor && (
                    <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">
                      <span className="flex-1">
                        Remove {m.minor}? Its study plan goes with it; its{" "}
                        {courseCount} course{courseCount === 1 ? "" : "s"} stay in the
                        catalogue.
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmDelete(null)}
                      >
                        Keep it
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy !== null}
                        onClick={async () => {
                          await run(
                            m.minor,
                            () => deleteMinor(department, m.minor),
                            "Removed.",
                          );
                          setConfirmDelete(null);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  )}

                  <div className="mt-3 overflow-hidden rounded-xl border border-border">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
                      <span className="text-sm font-medium text-foreground">
                        {minorTitle(m.minor)} — study plan
                      </span>
                      {canWrite && (
                        <Button
                          size="sm"
                          variant={editingPlan === m.minor ? "default" : "outline"}
                          onClick={() =>
                            setEditingPlan(editingPlan === m.minor ? null : m.minor)
                          }
                        >
                          <ClipboardList className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                          {editingPlan === m.minor ? "Done" : "Edit study plan"}
                        </Button>
                      )}
                    </div>
                    {editingPlan === m.minor ? (
                      <div className="p-3">
                        <MinorPlanEditor department={department} plan={m} onChanged={load} />
                      </div>
                    ) : m.baskets.length === 0 ? (
                      <p className="px-3 py-3 text-sm text-muted-foreground">
                        No study plan yet.
                        {canWrite && " Edit it to add each semester's baskets."}
                      </p>
                    ) : (
                      <MinorPlanTable plan={m} caption={`${minorTitle(m.minor)} study plan`} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/70 p-3">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New minor, e.g. Biomedical Engineering"
              className="h-9 min-w-[16rem] flex-1"
              aria-label="New minor name"
            />
            <Input
              type="number"
              min={1}
              value={newCredits}
              onChange={(e) => setNewCredits(Number(e.target.value))}
              className="h-9 w-20"
              aria-label="Credits required"
            />
            <span className="text-xs text-muted-foreground">credits</span>
            <Button
              size="sm"
              disabled={busy !== null || !newName.trim()}
              onClick={async () => {
                await run(
                  "new",
                  () => addMinor(department, newName, newCredits),
                  "Minor added.",
                );
                setNewName("");
              }}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add minor
            </Button>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
