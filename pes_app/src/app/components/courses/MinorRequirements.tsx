import { useCallback, useEffect, useState } from "react";
import { GraduationCap, Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ErrorState, SectionCard, SkeletonRows, StatusBadge } from "../common";
import { supabase } from "../../../lib/supabase";

interface MinorRow {
  minor: string;
  required_credits: number;
}

/**
 * The minors a department offers, and what each one costs in credits.
 *
 * The handbook names the minor streams but prints no credit total for them —
 * it says only that a minor is claimed after "an approved combination of
 * Courses", made known to students in advance. That approval is the
 * department's, so the number lives here rather than being guessed once in a
 * migration and then quietly wrong for four years.
 *
 * Two halves make a minor work and they are edited in different places. Which
 * courses belong to a stream is a property of each course, set in the course
 * editor; how many of those credits amount to the minor is set here. A stream
 * named on a course with no row here is listed as unconfigured rather than
 * silently ignored, because from the student's side it would simply never
 * appear.
 */
export function MinorRequirements({
  department,
  minorsInUse,
}: {
  department: string;
  /** Stream names tagged on this department's courses. */
  minorsInUse: string[];
}) {
  const [rows, setRows] = useState<MinorRow[]>([]);
  const [credits, setCredits] = useState<Record<string, number>>({});
  const [newName, setNewName] = useState("");
  const [newCredits, setNewCredits] = useState(5);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!department) return;
    setLoading(true);
    const { data, error: readError } = await supabase
      .from("minor_requirements")
      .select("minor, required_credits")
      .eq("department", department)
      .order("minor");
    if (readError) {
      setError(readError.message);
      setLoading(false);
      return;
    }
    const list = (data ?? []) as MinorRow[];
    setRows(list);
    setCredits(Object.fromEntries(list.map((r) => [r.minor, r.required_credits])));
    setLoading(false);
  }, [department]);

  useEffect(() => {
    load();
  }, [load]);

  const saveCredits = async (minor: string) => {
    const value = credits[minor];
    if (!Number.isFinite(value) || value < 1) {
      return setError("A minor has to be worth at least one credit.");
    }
    setBusy(minor);
    setError(null);
    const { error: writeError } = await supabase
      .from("minor_requirements")
      .update({ required_credits: value })
      .eq("department", department)
      .eq("minor", minor);
    setBusy(null);
    if (writeError) return setError(writeError.message);
    await load();
  };

  const add = async (minor: string, required: number) => {
    if (!minor.trim()) return setError("A minor needs a name.");
    setBusy(minor);
    setError(null);
    const { error: writeError } = await supabase
      .from("minor_requirements")
      .insert({
        department,
        minor: minor.trim(),
        required_credits: required,
      });
    setBusy(null);
    if (writeError) return setError(writeError.message);
    setNewName("");
    setNewCredits(5);
    await load();
  };

  const remove = async (minor: string) => {
    setBusy(minor);
    setError(null);
    const { error: writeError } = await supabase
      .from("minor_requirements")
      .delete()
      .eq("department", department)
      .eq("minor", minor);
    setBusy(null);
    if (writeError) return setError(writeError.message);
    await load();
  };

  const configured = new Set(rows.map((r) => r.minor));
  const unconfigured = [...new Set(minorsInUse)].filter(
    (m) => m && !configured.has(m),
  );

  return (
    <SectionCard
      title="Minor specialisations"
      description="Which minors this department offers and how many credits each takes. Courses are tagged with their stream in the course editor."
    >
      {error && <ErrorState message={error} size="inline" />}

      {loading ? (
        <SkeletonRows count={2} height="h-10" />
      ) : (
        <div className="space-y-2">
          {rows.length === 0 && unconfigured.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No minors set up yet. Add one below, then tag its courses in the
              course editor.
            </p>
          )}

          {rows.map((r) => {
            const tagged = minorsInUse.filter((m) => m === r.minor).length;
            return (
              <div
                key={r.minor}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2"
              >
                <GraduationCap
                  className="h-4 w-4 flex-shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                  {r.minor}
                </span>
                <StatusBadge tone={tagged > 0 ? "info" : "warning"}>
                  {tagged} course{tagged === 1 ? "" : "s"} tagged
                </StatusBadge>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  className="h-8 w-20"
                  value={credits[r.minor] ?? r.required_credits}
                  onChange={(e) =>
                    setCredits((prev) => ({
                      ...prev,
                      [r.minor]: Number(e.target.value),
                    }))
                  }
                />
                <span className="text-xs text-muted-foreground">credits</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    busy === r.minor ||
                    (credits[r.minor] ?? r.required_credits) ===
                      r.required_credits
                  }
                  onClick={() => saveCredits(r.minor)}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === r.minor}
                  onClick={() => remove(r.minor)}
                  aria-label={`Remove ${r.minor}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            );
          })}

          {unconfigured.length > 0 && (
            <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5">
              <p className="text-sm font-medium text-warning-fg">
                Tagged on courses but not set up
              </p>
              <p className="mt-0.5 text-xs text-warning-fg/90">
                Students see no progress for these until they have a credit
                requirement.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {unconfigured.map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    variant="outline"
                    disabled={busy === m}
                    onClick={() => add(m, 5)}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    {m}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Input
              className="h-8 min-w-0 flex-1"
              placeholder="New minor, e.g. Biomedical Engineering"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Input
              type="number"
              min={1}
              max={60}
              className="h-8 w-20"
              value={newCredits}
              onChange={(e) => setNewCredits(Number(e.target.value))}
            />
            <span className="text-xs text-muted-foreground">credits</span>
            <Button
              size="sm"
              disabled={!newName.trim() || busy === newName}
              onClick={() => add(newName, newCredits)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Add minor
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
