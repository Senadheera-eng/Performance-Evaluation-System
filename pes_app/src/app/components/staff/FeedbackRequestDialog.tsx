import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { CourseCode, ErrorState, StatusBadge } from "../common";
import { describeBatch } from "../../../lib/batch";
import type { FeedbackQuestion } from "../../../lib/feedbackService";
import type {
  FeedbackRequest,
  FeedbackRequestDraft,
  TeachingOffering,
} from "../../../lib/staffService";
import { departmentByCourseCode } from "../../../lib/departments";

const TYPE_LABEL: Record<string, string> = {
  rating: "Rating 1–5",
  single_choice: "Choose one",
  multi_select: "Pick several",
  yes_no: "Yes / No",
  short_text: "Short answer",
  long_text: "Long answer",
};

/** One cohort a lecturer teaches: the same course to the same batch in the
 *  same year. A form covers exactly one, because a period carries a single
 *  batch and that is what decides which students are eligible. */
interface Cohort {
  key: string;
  academic_year: string;
  semester: number;
  batch_year: number;
  offerings: TeachingOffering[];
}

const cohortKey = (o: { academic_year: string; semester: number; batch_year: number }) =>
  `${o.academic_year}|${o.semester}|${o.batch_year}`;

/** `datetime-local` wants wall-clock time in the viewer's own zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function defaultWindow(): { opens: string; closes: string } {
  const opens = new Date();
  const closes = new Date();
  closes.setDate(closes.getDate() + 14);
  return { opens: toLocalInput(opens.toISOString()), closes: toLocalInput(closes.toISOString()) };
}

/**
 * The form a lecturer fills in to ask for a feedback round.
 *
 * Two things are deliberately not free text. The cohort comes from what they
 * actually teach, so the batch on the period always matches the students who
 * will be asked; and the questions come from the department's bank, so a
 * lecturer cannot put wording in front of students that the department never
 * wrote. Both are also enforced in the database — the course policy refuses a
 * course they do not teach whatever this dialog sends.
 */
export function FeedbackRequestDialog({
  open,
  onOpenChange,
  existing,
  teaching,
  bank,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null when raising a new request. */
  existing: FeedbackRequest | null;
  teaching: TeachingOffering[];
  bank: FeedbackQuestion[];
  onSave: (draft: FeedbackRequestDraft) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [title, setTitle] = useState("");
  const [feedbackType, setFeedbackType] =
    useState<"mid_semester" | "end_semester">("end_semester");
  const [cohort, setCohort] = useState("");
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [questionIds, setQuestionIds] = useState<string[]>([]);
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [allowEditing, setAllowEditing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cohorts = useMemo<Cohort[]>(() => {
    const map = new Map<string, Cohort>();
    for (const o of teaching) {
      const key = cohortKey(o);
      const found = map.get(key);
      if (found) {
        found.offerings.push(o);
      } else {
        map.set(key, {
          key,
          academic_year: o.academic_year,
          semester: o.semester,
          batch_year: o.batch_year,
          offerings: [o],
        });
      }
    }
    /* The cohort being taught now comes first, so a request opens on it
       rather than on whichever batch happens to sort highest. */
    return [...map.values()].sort(
      (a, b) =>
        Number(b.offerings.some((o) => o.is_current)) -
          Number(a.offerings.some((o) => o.is_current)) ||
        b.batch_year - a.batch_year ||
        b.semester - a.semester,
    );
  }, [teaching]);

  const selected = cohorts.find((c) => c.key === cohort) ?? null;

  useEffect(() => {
    if (!open) return;
    setError(null);

    if (existing) {
      setTitle(existing.title);
      setFeedbackType(existing.feedback_type);
      setCohort(
        cohortKey({
          academic_year: existing.academic_year,
          semester: existing.semester,
          batch_year: existing.batch_year ?? 0,
        }),
      );
      setCourseIds(existing.course_ids);
      setQuestionIds(existing.question_ids);
      setOpensAt(toLocalInput(existing.opens_at));
      setClosesAt(toLocalInput(existing.closes_at));
      setAllowEditing(existing.allow_editing);
      return;
    }

    const window = defaultWindow();
    setTitle("");
    setFeedbackType("end_semester");
    setCohort(cohorts[0]?.key ?? "");
    setCourseIds([]);
    /* Every question in the bank, ticked. The bank is the department's
       standard form, and most requests use all of it — starting from none
       meant clicking through forty boxes to get back to the default. The
       lecturer now removes what does not apply instead. */
    setQuestionIds(bank.map((q) => q.id));
    setOpensAt(window.opens);
    setClosesAt(window.closes);
    setAllowEditing(true);
  }, [open, existing, cohorts, bank]);

  /* Grouped into the same sections, in the same order, that a student sees. */
  const sections = useMemo(() => {
    const map = new Map<
      string,
      { title: string; order: number; questions: FeedbackQuestion[] }
    >();
    for (const q of bank) {
      const key = q.section_key ?? "general";
      const found = map.get(key);
      if (found) found.questions.push(q);
      else
        map.set(key, {
          title: q.section_title ?? "General",
          order: q.section_order,
          questions: [q],
        });
    }
    return [...map.entries()]
      .map(([key, s]) => ({ key, ...s }))
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  }, [bank]);

  /**
   * Selecting a conditional question pulls in the question that reveals it,
   * and dropping a gate drops everything it guarded. A dependent question
   * without its gate can never be shown, so the form would silently carry a
   * question no student is ever asked.
   */
  const toggleQuestion = (question: FeedbackQuestion) => {
    setQuestionIds((prev) => {
      if (prev.includes(question.id)) {
        const dependents = bank
          .filter((q) => q.depends_on_question_id === question.id)
          .map((q) => q.id);
        return prev.filter((id) => id !== question.id && !dependents.includes(id));
      }
      const gate = question.depends_on_question_id;
      const next = [...prev, question.id];
      if (gate && !next.includes(gate)) next.push(gate);
      return next;
    });
  };

  const toggleCourse = (courseId: string) =>
    setCourseIds((prev) =>
      prev.includes(courseId)
        ? prev.filter((id) => id !== courseId)
        : [...prev, courseId],
    );

  const save = async () => {
    if (!title.trim()) return setError("Give the form a title students will recognise.");
    if (!selected) return setError("Choose which of your courses this is about.");
    if (courseIds.length === 0) return setError("Select at least one course.");
    if (questionIds.length === 0) return setError("Select at least one question.");
    if (!opensAt || !closesAt) return setError("Set when the form opens and closes.");
    if (new Date(closesAt) <= new Date(opensAt)) {
      return setError("The closing time has to be after the opening time.");
    }

    setSaving(true);
    setError(null);
    const result = await onSave({
      title: title.trim(),
      feedback_type: feedbackType,
      academic_year: selected.academic_year,
      semester: selected.semester,
      batch_year: selected.batch_year,
      opens_at: new Date(opensAt).toISOString(),
      closes_at: new Date(closesAt).toISOString(),
      allow_editing: allowEditing,
      course_ids: courseIds,
      question_ids: questionIds,
    });
    setSaving(false);

    if (!result.ok) return setError(result.error ?? "Could not save this request.");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Edit feedback request" : "Request a feedback form"}
          </DialogTitle>
          <DialogDescription>
            Your department reviews this before any student sees it.
          </DialogDescription>
        </DialogHeader>

        {error && <ErrorState message={error} size="inline" />}

        {cohorts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You have no course assignments yet, so there is nothing to ask
            students about. Your head of department assigns these.
          </p>
        ) : (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Title</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Semester 7 end-of-course feedback"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">When</label>
                <div className="flex gap-1.5">
                  {(
                    [
                      ["mid_semester", "Mid semester"],
                      ["end_semester", "End semester"],
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={feedbackType === value ? "default" : "outline"}
                      onClick={() => setFeedbackType(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Cohort</label>
                <select
                  value={cohort}
                  onChange={(e) => {
                    setCohort(e.target.value);
                    setCourseIds([]);
                  }}
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground"
                >
                  {cohorts.map((c) => (
                    <option key={c.key} value={c.key}>
                      {describeBatch(c.batch_year)} · Semester {c.semester} ·{" "}
                      {c.academic_year}
                      {c.offerings.some((o) => o.is_current) ? " (Current)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Opens</label>
                <Input
                  type="datetime-local"
                  value={opensAt}
                  onChange={(e) => setOpensAt(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Closes</label>
                <Input
                  type="datetime-local"
                  value={closesAt}
                  onChange={(e) => setClosesAt(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">Courses</label>
                <span className="text-xs text-muted-foreground">
                  {courseIds.length} selected
                </span>
              </div>
              <ul className="divide-y divide-border/70 rounded-xl border border-border/70">
                {(selected?.offerings ?? []).map((o) => (
                  <li key={o.offering_id}>
                    <label
                      className={`flex cursor-pointer items-center gap-3 border-l-4 px-3 py-2.5 transition-colors ${
                        departmentByCourseCode(o.course_code)?.stripeClass ?? "border-l-transparent"
                      } ${
                        courseIds.includes(o.course_id)
                          ? (departmentByCourseCode(o.course_code)?.softClass ?? "bg-muted")
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <Checkbox
                        checked={courseIds.includes(o.course_id)}
                        onCheckedChange={() => toggleCourse(o.course_id)}
                      />
                      <span className="min-w-0 flex-1">
                        <CourseCode code={o.course_code} className="text-sm" />
                        <span className="ml-2 text-sm text-foreground">
                          {o.course_title}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {o.enrolled_count} student
                          {o.enrolled_count === 1 ? "" : "s"}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">Questions</label>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {questionIds.length} of {bank.length} selected
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={questionIds.length === bank.length}
                    onClick={() => setQuestionIds(bank.map((q) => q.id))}
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={questionIds.length === 0}
                    onClick={() => setQuestionIds([])}
                  >
                    Clear all
                  </Button>
                </span>
              </div>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                Questions come from your department's bank. Ones marked “per
                lecturer” are asked separately about each person teaching the
                course.
              </p>
              <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl border border-border/70 p-3">
                {sections.map((section) => (
                  <div key={section.key}>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {section.title}
                    </p>
                    <ul className="space-y-1">
                      {section.questions.map((q) => {
                        const gate = q.depends_on_question_id
                          ? bank.find((b) => b.id === q.depends_on_question_id)
                          : null;
                        return (
                          <li key={q.id}>
                            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1 hover:bg-muted/50">
                              <Checkbox
                                className="mt-0.5"
                                checked={questionIds.includes(q.id)}
                                onCheckedChange={() => toggleQuestion(q)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="text-sm text-foreground">
                                  {q.question_text}
                                </span>
                                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                  <StatusBadge tone="neutral">
                                    {TYPE_LABEL[q.question_type] ?? q.question_type}
                                  </StatusBadge>
                                  {q.target_type === "lecturer" && (
                                    <StatusBadge tone="brand">Per lecturer</StatusBadge>
                                  )}
                                  {gate && (
                                    <span className="text-[11px] text-muted-foreground">
                                      shown after “{gate.question_text}”
                                    </span>
                                  )}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-2.5">
              <Checkbox
                className="mt-0.5"
                checked={allowEditing}
                onCheckedChange={(v) => setAllowEditing(v === true)}
              />
              <span>
                <span className="text-sm text-foreground">
                  Let students change their answers
                </span>
                <span className="block text-xs text-muted-foreground">
                  Until the form closes. Off means one submission, final.
                </span>
              </span>
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || cohorts.length === 0}>
            {saving
              ? "Saving…"
              : existing
                ? "Save changes"
                : "Send to department"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
