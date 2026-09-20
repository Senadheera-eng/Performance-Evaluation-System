import { useCallback, useEffect, useState } from "react";
import { Check, GraduationCap, Pencil, Plus, Trash2, X } from "lucide-react";
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
  getDepartmentMinors,
  renameMinor,
  setMinorCredits,
  type DepartmentMinor,
} from "../../../lib/minors";

/**
 * A department's minor specialisations, managed in one place.
 *
 * The handbook names the streams but prints no credit total for them — it
 * says only that a minor is claimed after "an approved combination of
 * Courses", made known to students in advance. That approval is the
 * department's, so the number is set here rather than guessed once in a
 * migration and then quietly wrong for four years.
 *
 * Which courses carry a stream is a property of each course, set in the
 * course editor; this screen shows what that adds up to. Renaming a stream
 * retags its courses and removing one untags them, both in a single database
 * call — done as two writes from here, a half-finished rename would leave
 * courses pointing at a minor that no longer exists.
 */
export function MinorSpecifications({
  department,
  canWrite,
}: {
  department: string;
  /** False for a reader — the lists still show, the controls do not. */
  canWrite: boolean;
}) {
  const [minors, setMinors] = useState<DepartmentMinor[]>([]);
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
    const result = await getDepartmentMinors(department);
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
        description={`Which minors ${department} offers, how many credits each takes, and the courses carrying them. A course joins a minor in the course editor.`}
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
                  ? "Add a stream below, then tag its courses in the course editor."
                  : "This department has not set up any minor specialisations."
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {minors.map((m) => {
              const short = m.tagged_credits < m.required_credits;
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
                            {m.tagged_courses} course
                            {m.tagged_courses === 1 ? "" : "s"} ·{" "}
                            {m.tagged_credits} of {m.required_credits} credits
                          </StatusBadge>
                        </p>
                        {m.courses.length > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {m.courses
                              .map(
                                (c) =>
                                  `${c.course_code} (Sem ${c.semester}, ${c.credits}cr)`,
                              )
                              .join(" · ")}
                          </p>
                        )}
                        {short && (
                          /* Not an error: a stream can be short while its
                             courses are still being tagged. Worth saying,
                             because a student cannot claim it either way. */
                          <p className="mt-1 text-xs text-warning-fg">
                            Tagged courses come to fewer credits than this minor
                            requires.
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
                        Remove {m.minor}? Its {m.tagged_courses} course
                        {m.tagged_courses === 1 ? "" : "s"} stay in the
                        catalogue and stop belonging to a stream.
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
