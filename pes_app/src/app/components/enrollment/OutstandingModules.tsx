import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, RotateCcw, Stethoscope } from "lucide-react";
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
  period_batch: number;
  closes_at: string;
  capacity: number | null;
  enrolled_count: number;
  already_enrolled: boolean;
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
 */
export function OutstandingModules({ onEnrolled }: { onEnrolled?: () => void }) {
  const { student } = useAuth();
  const [options, setOptions] = useState<Option[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc("get_my_enrolment_options");
    if (rpcError) {
      console.error("[enrolment options]", rpcError);
      setError("We could not check your outstanding modules.");
      setLoading(false);
      return;
    }
    setOptions(((data ?? []) as Option[]).filter((o) => o.kind !== "regular"));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (student) load();
  }, [student, load]);

  const toggle = (courseId: string) =>
    setSelected((prev) =>
      prev.includes(courseId)
        ? prev.filter((id) => id !== courseId)
        : [...prev, courseId],
    );

  const enrol = async () => {
    const rows = options.filter((o) => selected.includes(o.course_id));
    if (rows.length === 0) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    // The academic year comes from the window the module is actually offered
    // in, not from the student's own year — that is the point of a repeat.
    const { data: periods } = await supabase
      .from("enrollment_periods")
      .select("id, academic_year")
      .in("id", [...new Set(rows.map((r) => r.period_id))]);
    const yearOf = new Map((periods ?? []).map((p: any) => [p.id, p.academic_year]));

    const { error: insertError } = await supabase.from("enrollments").insert(
      rows.map((r) => ({
        student_id: student!.id,
        course_id: r.course_id,
        academic_year: yearOf.get(r.period_id),
        status: "enrolled",
        enrollment_kind: r.kind,
        enrolled_with_batch: r.period_batch,
      })),
    );
    setSaving(false);

    if (insertError) {
      console.error("[enrolment repeat]", insertError);
      setError("That enrolment was refused. Please tell your department.");
      return;
    }
    setSelected([]);
    setNotice(
      `Enrolled in ${rows.length} module${rows.length === 1 ? "" : "s"}. You will take ${rows.length === 1 ? "it" : "them"} with the batch shown.`,
    );
    await load();
    onEnrolled?.();
  };

  if (loading) return <SkeletonRows count={2} height="h-16" />;
  if (options.length === 0) return null;

  return (
    <div className="space-y-4">
      {error && <ErrorState message={error} size="inline" />}
      {notice && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border-l-4 border-primary bg-primary/5 px-4 py-3 text-sm text-foreground">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
        <span>
          You have modules still to clear, and they are open for enrolment now
          with a later batch. Enrol in them here.
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
              {rows.map((o) => (
                <li
                  key={o.course_id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                    <Checkbox
                      className="mt-0.5"
                      checked={selected.includes(o.course_id)}
                      disabled={o.already_enrolled}
                      onCheckedChange={() => toggle(o.course_id)}
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-primary">
                          {o.course_code}
                        </span>
                        <span className="text-sm text-foreground">{o.title}</span>
                        <StatusBadge tone={group.tone} icon={group.icon}>
                          {o.kind === "repeat_r" ? "Repeat (R)" : "Medical (L)"}
                        </StatusBadge>
                        {o.already_enrolled && (
                          <StatusBadge tone="success" icon={CheckCircle2}>
                            Enrolled
                          </StatusBadge>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {o.credits} credit{o.credits === 1 ? "" : "s"} · Semester{" "}
                        {o.semester} · taken with {describeBatch(o.period_batch)} ·
                        closes {new Date(o.closes_at).toLocaleDateString()}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </SectionCard>
        );
      })}

      <Button
        disabled={selected.length === 0 || saving}
        onClick={enrol}
      >
        {saving
          ? "Enrolling…"
          : `Enrol in ${selected.length || ""} outstanding module${selected.length === 1 ? "" : "s"}`.trim()}
      </Button>
    </div>
  );
}
