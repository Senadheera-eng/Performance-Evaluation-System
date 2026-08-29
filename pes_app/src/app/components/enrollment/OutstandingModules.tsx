import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Lock,
  Minus,
  Plus,
  RotateCcw,
  Stethoscope,
} from "lucide-react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { ErrorState, SectionCard, SkeletonRows, StatusBadge } from "../common";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { describeBatch } from "../../../lib/batch";

interface Option {
  course_id: string;
  course_code: string;
  title: string;
  credits: number;
  semester: number;
  category: string;
  department: string;
  kind: "regular" | "repeat_r" | "repeat_l";
  outstanding_from: string | null;
  period_id: string;
  period_title: string;
  /** Null when no batch is in that semester — a sitting laid on for repeats. */
  period_batch: number | null;
  closes_at: string;
  capacity: number | null;
  enrolled_count: number;
  already_enrolled: boolean;
  /** A mark for this sitting is already recorded, so the place is fixed. */
  locked: boolean;
}

const GROUPS = [
  {
    kind: "repeat_r" as const,
    title: "Repeat Modules (R)",
    icon: RotateCcw,
    tone: "warning" as const,
    blurb:
      "You carry an R in these. The highest grade a repeat can be awarded is C.",
  },
  {
    kind: "repeat_l" as const,
    title: "L-Grade Modules (L)",
    icon: Stethoscope,
    tone: "info" as const,
    blurb:
      "You carry an L in these. There is no cap — you can still earn any grade.",
  },
];

/**
 * Modules the student still owes, offered to a later batch.
 *
 * A student carrying an R or an L has to take that module again whenever it is
 * next delivered, which is normally to the batch below. Eligibility used to be
 * decided by the student's own batch year alone, so the window that actually
 * carried their module was invisible to them.
 *
 * The two kinds are kept apart on purpose. They are different obligations — a
 * repeat is capped at C, a medical re-sit is not — and a student looking at a
 * mixed list cannot tell which rule applies to which module.
 *
 * A repeat can be withdrawn from while the window that carries it is open, on
 * the same terms as any other course: this list only ever shows modules under
 * an open window, so anything here is still the student's to change until a
 * mark lands against the sitting.
 */
export function OutstandingModules({ onChanged }: { onChanged?: () => void }) {
  const { student } = useAuth();
  const [options, setOptions] = useState<Option[]>([]);
  /** Ticks made since the last save, as course_id → wanted. */
  const [draft, setDraft] = useState<Map<string, boolean>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc(
      "get_my_enrolment_options",
    );
    if (rpcError) {
      console.error("[enrolment options]", rpcError);
      setError("We could not check your outstanding modules.");
      setLoading(false);
      return;
    }
    setOptions(((data ?? []) as Option[]).filter((o) => o.kind !== "regular"));
    setDraft(new Map());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (student) load();
  }, [student, load]);

  const chosen = (o: Option) => draft.get(o.course_id) ?? o.already_enrolled;

  const toggle = (o: Option) => {
    if (o.locked) return;
    setDraft((prev) => {
      const next = new Map(prev);
      const want = !chosen(o);
      if (want === o.already_enrolled) next.delete(o.course_id);
      else next.set(o.course_id, want);
      return next;
    });
  };

  const { adds, removes } = useMemo(() => {
    const a: Option[] = [];
    const r: Option[] = [];
    options.forEach((o) => {
      const want = draft.get(o.course_id) ?? o.already_enrolled;
      if (want && !o.already_enrolled) a.push(o);
      if (!want && o.already_enrolled) r.push(o);
    });
    return { adds: a, removes: r };
  }, [options, draft]);

  const dirty = adds.length + removes.length > 0;

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    // The academic year and the batch a repeat is sat with come from the
    // window carrying the module, which the function reads for itself.
    const { error: rpcError } = await supabase.rpc("update_my_enrolment", {
      p_add: adds.map((o) => o.course_id),
      p_remove: removes.map((o) => o.course_id),
    });
    setSaving(false);

    if (rpcError) {
      console.error("[enrolment repeat]", rpcError);
      setError(rpcError.message);
      return;
    }

    const parts = [
      adds.length > 0 &&
        `enrolled in ${adds.length} module${adds.length === 1 ? "" : "s"}`,
      removes.length > 0 &&
        `withdrew from ${removes.length} module${removes.length === 1 ? "" : "s"}`,
    ].filter(Boolean);
    await load();
    onChanged?.();
    setNotice(`Outstanding modules saved — ${parts.join(" and ")}.`);
  };

  if (loading) return <SkeletonRows count={2} height="h-16" />;
  if (options.length === 0) return null;

  return (
    <div className="space-y-4">
      {error && <ErrorState message={error} size="inline" />}
      {notice && (
        <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2 text-sm text-success-fg">
          {notice}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border-l-4 border-primary bg-primary/5 px-4 py-3 text-sm text-foreground">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
        <span>
          You have modules still to clear and they are open for enrolment now.
          Enrol in them here.
        </span>
      </div>

      {GROUPS.map((group) => {
        const rows = options.filter((o) => o.kind === group.kind);
        if (rows.length === 0) return null;
        return (
          <SectionCard
            key={group.kind}
            title={group.title}
            description={group.blurb}
            flush
          >
            <ul className="divide-y divide-border/70">
              {rows.map((o) => {
                const want = chosen(o);
                const changed = draft.has(o.course_id);
                return (
                  <li
                    key={o.course_id}
                    className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
                      changed ? "bg-primary/5" : ""
                    }`}
                  >
                    <label
                      className={`flex min-w-0 flex-1 items-start gap-3 ${
                        o.locked ? "cursor-default" : "cursor-pointer"
                      }`}
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={want}
                        disabled={o.locked}
                        onCheckedChange={() => toggle(o)}
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-primary">
                            {o.course_code}
                          </span>
                          <span className="text-sm text-foreground">
                            {o.title}
                          </span>
                          <StatusBadge tone={group.tone} icon={group.icon}>
                            {o.kind === "repeat_r" ? "Repeat (R)" : "Medical (L)"}
                          </StatusBadge>
                          {o.already_enrolled && !changed && (
                            <StatusBadge tone="success" icon={CheckCircle2}>
                              Enrolled
                            </StatusBadge>
                          )}
                          {changed && (
                            <StatusBadge
                              tone={want ? "brand" : "warning"}
                              icon={want ? Plus : Minus}
                            >
                              {want ? "Adding" : "Withdrawing"}
                            </StatusBadge>
                          )}
                          {o.locked && (
                            <StatusBadge tone="neutral" icon={Lock}>
                              Marks recorded
                            </StatusBadge>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {o.credits} credit{o.credits === 1 ? "" : "s"} ·
                          Semester {o.semester} ·{" "}
                          {o.period_batch !== null
                            ? `taken with ${describeBatch(o.period_batch)}`
                            : "a sitting laid on for repeats"}{" "}
                          · closes {new Date(o.closes_at).toLocaleDateString()}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!dirty || saving} onClick={save}>
          {saving
            ? "Saving…"
            : dirty
              ? "Save outstanding modules"
              : "No changes"}
        </Button>
        {dirty && (
          <>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setDraft(new Map())}
            >
              Discard
            </Button>
            <span className="text-xs text-muted-foreground">
              {[
                adds.length > 0 &&
                  `Adding ${adds.map((o) => o.course_code).join(", ")}`,
                removes.length > 0 &&
                  `Withdrawing ${removes.map((o) => o.course_code).join(", ")}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
