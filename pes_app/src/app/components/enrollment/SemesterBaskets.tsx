import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  GraduationCap,
  Info,
} from "lucide-react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  EmptyState,
  ErrorState,
  SectionCard,
  SkeletonRows,
  StatusBadge,
} from "../common";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";

interface PlanCourse {
  course_id: string;
  course_code: string;
  title: string;
  credits: number;
  contributes_to_gpa: boolean;
  minor: string | null;
  selected: boolean;
  already_passed: boolean;
}

interface Basket {
  basket: string;
  required_credits: number | null;
  selected_credits: number;
  available_credits: number;
  courses: PlanCourse[];
}

interface MinorProgress {
  minor: string;
  required_credits: number;
  earned_credits: number;
  selected_credits: number;
  status: "complete" | "partial" | "none";
}

interface Plan {
  semester: number;
  academic_year: string;
  department: string;
  window: { period_id: string; title: string; closes_at: string } | null;
  baskets: Basket[];
  minors: MinorProgress[];
}

/**
 * The semester as the handbook prints it: baskets, not a list.
 *
 * A student does not take every course in Semester 7 — they take the
 * compulsory ones and satisfy each elective basket for the credits it asks
 * for. Showing a flat list of fifteen courses left the rules in the handbook
 * and the arithmetic to the student.
 *
 * Nothing here refuses anything. A basket's requirement is what it asks for,
 * not a ceiling, so a student who wants a third elective may take it; a
 * student who leaves a compulsory course unticked is told plainly and still
 * allowed to submit. The department, not this page, decides what to do about
 * it.
 */
export function SemesterBaskets({ onEnrolled }: { onEnrolled?: () => void }) {
  const { student } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc(
      "get_my_enrolment_plan",
    );
    if (rpcError) {
      setError("We could not load your semester plan.");
      setLoading(false);
      return;
    }
    setPlan(data as Plan);
    setPicked(new Set());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (student) load();
  }, [student, load]);

  /** Enrolled already, or ticked in this session. */
  const isChosen = (c: PlanCourse) => c.selected || picked.has(c.course_id);

  const toggle = (c: PlanCourse) => {
    if (c.selected || c.already_passed) return; // already on the record
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(c.course_id)
        ? next.delete(c.course_id)
        : next.add(c.course_id);
      return next;
    });
  };

  /* Live totals per basket, counting what is already enrolled plus what has
     been ticked but not yet submitted. */
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    plan?.baskets.forEach((b) => {
      map.set(
        b.basket,
        b.courses.reduce((n, c) => n + (isChosen(c) ? c.credits : 0), 0),
      );
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, picked]);

  const warnings = useMemo(() => {
    if (!plan) return [];
    const out: string[] = [];
    plan.baskets.forEach((b) => {
      const have = totals.get(b.basket) ?? 0;
      if (b.basket === "Compulsory") {
        const missing = b.courses.filter((c) => !isChosen(c) && !c.already_passed);
        if (missing.length > 0) {
          out.push(
            `${missing.length} compulsory course${missing.length === 1 ? "" : "s"} not selected: ${missing
              .map((c) => c.course_code)
              .join(", ")}.`,
          );
        }
      } else if (b.required_credits && have < b.required_credits) {
        out.push(
          `${b.basket} needs ${b.required_credits} credit${b.required_credits === 1 ? "" : "s"} — you have ${have}.`,
        );
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, totals, picked]);

  const enrol = async () => {
    if (!plan?.window || picked.size === 0) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    const { data: period } = await supabase
      .from("enrollment_periods")
      .select("academic_year")
      .eq("id", plan.window.period_id)
      .maybeSingle();

    const { error: insertError } = await supabase.from("enrollments").insert(
      [...picked].map((course_id) => ({
        student_id: student!.id,
        course_id,
        academic_year: period?.academic_year ?? plan.academic_year,
        status: "enrolled",
        enrollment_kind: "regular",
      })),
    );
    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }
    setNotice(`Enrolled in ${picked.size} course${picked.size === 1 ? "" : "s"}.`);
    await load();
    onEnrolled?.();
  };

  if (loading) return <SkeletonRows count={4} height="h-24" />;
  if (!plan) return error ? <ErrorState message={error} size="inline" /> : null;
  if (plan.baskets.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title={`No curriculum on record for Semester ${plan.semester}`}
        description="Your department sets out each semester's compulsory courses and elective baskets. Ask them to add this one."
      />
    );
  }

  return (
    <div className="space-y-4">
      {error && <ErrorState message={error} size="inline" />}
      {notice && (
        <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2 text-sm text-success-fg">
          {notice}
        </div>
      )}

      {plan.minors.length > 0 && (
        <SectionCard
          title="Minors"
          description="Optional. A minor is claimed once you have completed enough credits from its courses — across the whole degree, not one semester."
        >
          <ul className="space-y-2">
            {plan.minors.map((m) => {
              const have = m.earned_credits + m.selected_credits;
              const short = Math.max(0, m.required_credits - have);
              return (
                <li key={m.minor} className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {m.minor}
                  </span>
                  {m.status === "complete" ? (
                    <StatusBadge tone="success" icon={CheckCircle2}>
                      Complete
                    </StatusBadge>
                  ) : m.status === "partial" ? (
                    <StatusBadge tone="warning">
                      {short} more credit{short === 1 ? "" : "s"} needed
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">Not selected</StatusBadge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {have} of {m.required_credits} credits
                    {m.earned_credits > 0 &&
                      ` · ${m.earned_credits} already passed`}
                  </span>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}

      {plan.baskets.map((b) => {
        const have = totals.get(b.basket) ?? 0;
        const met = b.required_credits ? have >= b.required_credits : true;
        return (
          <SectionCard
            key={b.basket}
            title={b.basket}
            description={
              b.basket === "Compulsory"
                ? "Every course here is required."
                : b.basket === "Optional"
                  ? "Not required. Take these only if you want to."
                  : `Select ${b.required_credits} credit${b.required_credits === 1 ? "" : "s"} from this group. You may take more if you want to.`
            }
            actions={
              b.required_credits ? (
                <StatusBadge tone={met ? "success" : "warning"}>
                  {have} of {b.required_credits} credits
                </StatusBadge>
              ) : (
                <StatusBadge tone="neutral">{have} credits selected</StatusBadge>
              )
            }
            flush
          >
            <ul className="divide-y divide-border/70">
              {b.courses.map((c) => (
                <li key={c.course_id} className="px-4 py-2.5">
                  <label className="flex cursor-pointer items-start gap-3">
                    <Checkbox
                      className="mt-0.5"
                      checked={isChosen(c)}
                      disabled={c.selected || c.already_passed || !plan.window}
                      onCheckedChange={() => toggle(c)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-primary">
                          {c.course_code}
                        </span>
                        <span className="text-sm text-foreground">{c.title}</span>
                        {c.minor && (
                          <StatusBadge tone="info" icon={GraduationCap}>
                            {c.minor}
                          </StatusBadge>
                        )}
                        {!c.contributes_to_gpa && (
                          <StatusBadge tone="neutral">Not in GPA</StatusBadge>
                        )}
                        {c.already_passed && (
                          <StatusBadge tone="success">Passed</StatusBadge>
                        )}
                        {c.selected && !c.already_passed && (
                          <StatusBadge tone="success">Enrolled</StatusBadge>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {c.credits} credit{c.credits === 1 ? "" : "s"}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </SectionCard>
        );
      })}

      {warnings.length > 0 && (
        <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-sm text-warning-fg">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            Before you confirm
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs">
            You can still enrol — this is a note, not a block.
          </p>
        </div>
      )}

      {plan.window ? (
        <Button
          className="w-full"
          disabled={picked.size === 0 || saving}
          onClick={enrol}
        >
          {saving
            ? "Enrolling…"
            : picked.size === 0
              ? "Select courses to enrol"
              : `Confirm ${picked.size} course${picked.size === 1 ? "" : "s"}`}
        </Button>
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>
            Enrolment is not open for Semester {plan.semester}. This is what the
            semester looks like when it does open.
          </span>
        </div>
      )}
    </div>
  );
}
