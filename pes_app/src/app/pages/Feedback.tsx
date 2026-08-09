import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, GraduationCap, Lock, MessageSquareText } from "lucide-react";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonRows,
  StatusBadge,
} from "../components/common";
import { LikertMatrix } from "../components/feedback/LikertMatrix";
import { QuestionField } from "../components/feedback/QuestionField";
import { cn } from "../components/ui/utils";
import {
  answerKey,
  getFeedbackCatalogue,
  getFeedbackForm,
  isQuestionVisible,
  submitFeedback,
  type FeedbackAnswerInput,
  type FeedbackCatalogueRow,
  type FeedbackFormData,
  type FeedbackQuestion,
  type FeedbackSection,
} from "../../lib/feedbackService";

const MAX_TEXT = 1000;
const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8];
const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

const TYPE_LABEL: Record<string, string> = {
  mid_semester: "Mid Semester",
  end_semester: "End Semester",
};

const TYPE_WINDOW: Record<string, string> = {
  mid_semester: "Around week 7 of the semester",
  end_semester: "Week 13 onwards / up to 4 weeks after semester end",
};

/**
 * Course feedback, in the three steps the faculty's own portal uses: pick a
 * semester, pick a course, pick the round. A course can be open for a
 * mid-semester and an end-semester round at the same time, which is why the
 * round is a separate choice rather than something the course card decides.
 *
 * Responses are recorded without a name. The department's own form promises
 * strict confidentiality, and nothing here asks a student to weigh that up
 * mid-form.
 */
export default function Feedback() {
  const [rows, setRows] = useState<FeedbackCatalogueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [semester, setSemester] = useState<number | null>(null);
  const [chosenCourse, setChosenCourse] = useState<string | null>(null);
  const [chosenType, setChosenType] = useState<string | null>(null);
  const [active, setActive] = useState<FeedbackCatalogueRow | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    const result = await getFeedbackCatalogue();
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setRows(result.data);
    setLoading(false);
  };

  /* Which semesters have anything open, and which courses sit under each. */
  const bySemester = useMemo(() => {
    const map = new Map<number, FeedbackCatalogueRow[]>();
    for (const r of rows) {
      const found = map.get(r.semester);
      if (found) found.push(r);
      else map.set(r.semester, [r]);
    }
    return map;
  }, [rows]);

  const coursesInSemester = useMemo(() => {
    if (semester === null) return [];
    const seen = new Map<string, FeedbackCatalogueRow>();
    for (const r of bySemester.get(semester) ?? []) {
      if (!seen.has(r.course_id)) seen.set(r.course_id, r);
    }
    return [...seen.values()].sort((a, b) =>
      a.course_code.localeCompare(b.course_code),
    );
  }, [bySemester, semester]);

  /* The rounds open for the course the student just tapped. */
  const roundsForCourse = useMemo(() => {
    if (!chosenCourse) return [];
    return rows.filter((r) => r.course_id === chosenCourse);
  }, [rows, chosenCourse]);

  if (active) {
    return (
      <FeedbackFormView
        row={active}
        onBack={() => {
          setActive(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Course Feedback"
        description="Your feedback helps us improve course delivery and learning outcomes. Select your semester and course below to begin — all responses are treated with strict confidentiality."
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {loading ? (
        <SkeletonRows count={4} height="h-20" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          title="No feedback form is open"
          description="When your department opens a feedback round for a course you took, it appears here."
        />
      ) : (
        <>
          <section>
            <StepHeading number={1} title="Select Your Semester" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {SEMESTERS.map((s) => {
                const available = bySemester.has(s);
                const selected = semester === s;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={!available}
                    aria-pressed={selected}
                    onClick={() => {
                      setSemester(s);
                      setChosenCourse(null);
                    }}
                    className={cn(
                      "rounded-xl border p-4 text-center transition-all",
                      selected
                        ? "border-primary bg-primary text-primary-foreground shadow-elevation-sm"
                        : available
                          ? "border-border bg-card hover:border-primary/50"
                          : "cursor-not-allowed border-border/60 bg-muted/40 text-muted-foreground",
                    )}
                  >
                    <span className="block text-2xl font-semibold">{s}</span>
                    <span className="block text-xs">{ORDINAL[s]} Semester</span>
                    {!available && (
                      <span className="mt-0.5 block text-[11px]">
                        Not available
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {semester !== null && (
            <section>
              <StepHeading number={2} title="Select Your Course" />
                <ul className="grid gap-3 md:grid-cols-2">
                  {coursesInSemester.map((c) => {
                    const rounds = rows.filter((r) => r.course_id === c.course_id);
                    const done = rounds.every(
                      (r) => r.submission_status === "submitted",
                    );
                    return (
                      <li key={c.course_id}>
                        <button
                          type="button"
                          onClick={() => {
                            setChosenCourse(c.course_id);
                            setChosenType(null);
                          }}
                          className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-all hover:border-primary/50"
                        >
                          <span className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">
                            {c.course_code}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                            {c.course_title}
                          </span>
                          {done && (
                            <StatusBadge tone="success" icon={CheckCircle2}>
                              Done
                            </StatusBadge>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
            </section>
          )}
        </>
      )}

      <Dialog
        open={chosenCourse !== null}
        onOpenChange={(open) => !open && setChosenCourse(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Select Feedback Type</DialogTitle>
          </DialogHeader>
          {roundsForCourse[0] && (
            <p className="-mt-2 text-sm text-muted-foreground">
              <span className="font-semibold text-primary">
                {roundsForCourse[0].course_code}
              </span>{" "}
              — {roundsForCourse[0].course_title}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {(["mid_semester", "end_semester"] as const).map((type) => {
              const round = roundsForCourse.find((r) => r.feedback_type === type);
              const submitted = round?.submission_status === "submitted";
              const selected = chosenType === type;
              return (
                <button
                  key={type}
                  type="button"
                  disabled={!round}
                  aria-pressed={selected}
                  onClick={() => setChosenType(type)}
                  className={cn(
                    "rounded-xl border p-4 text-center transition-all",
                    selected
                      ? "border-primary bg-primary/10"
                      : round
                        ? "border-border hover:border-primary/50"
                        : "cursor-not-allowed border-border/60 bg-muted/40",
                  )}
                >
                  <GraduationCap
                    className={cn(
                      "mx-auto mb-1.5 h-6 w-6",
                      round ? "text-primary" : "text-muted-foreground",
                    )}
                    aria-hidden="true"
                  />
                  <span
                    className={cn(
                      "block text-sm font-semibold",
                      round ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {TYPE_LABEL[type]}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {round ? TYPE_WINDOW[type] : "Not available yet"}
                  </span>
                  {submitted && (
                    <StatusBadge tone="success" className="mt-1.5">
                      Already submitted
                    </StatusBadge>
                  )}
                </button>
              );
            })}
          </div>

          <Button
            disabled={!chosenType}
            onClick={() => {
              const round = roundsForCourse.find(
                (r) => r.feedback_type === chosenType,
              );
              if (!round) return;
              setChosenCourse(null);
              setActive(round);
            }}
          >
            Continue to Feedback Form →
          </Button>
          <button
            type="button"
            onClick={() => setChosenCourse(null)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Cancel, go back to course list
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StepHeading({ number, title }: { number: number; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {number}
      </span>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The form                                                            */
/* ------------------------------------------------------------------ */

function FeedbackFormView({
  row,
  onBack,
}: {
  row: FeedbackCatalogueRow;
  onBack: () => void;
}) {
  const [form, setForm] = useState<FeedbackFormData | null>(null);
  const [answers, setAnswers] = useState<Record<string, FeedbackAnswerInput>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const result = await getFeedbackForm(row.period_id, row.course_id);
      if (!result.ok) {
        setError(result.error);
        setLoading(false);
        return;
      }
      setForm(result.data);
      const existing: Record<string, FeedbackAnswerInput> = {};
      for (const a of result.data.submission?.answers ?? []) {
        existing[answerKey(a.question_id, a.lecturer_target_id)] = a;
      }
      setAnswers(existing);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.period_id, row.course_id]);

  const disabled = saving || done || (form ? !form.can_edit : true);

  const patch = (
    question: FeedbackQuestion,
    lecturerId: string | null,
    value: Partial<FeedbackAnswerInput>,
  ) => {
    const key = answerKey(question.id, lecturerId);
    setAnswers((prev) => ({
      ...prev,
      [key]: {
        question_id: question.id,
        lecturer_target_id: lecturerId,
        ...prev[key],
        ...value,
      },
    }));
  };

  const submit = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    const result = await submitFeedback(
      row.period_id,
      row.course_id,
      true,
      Object.values(answers),
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(true);
  };

  if (loading) return <SkeletonRows count={6} height="h-16" />;

  if (error && !form) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <ErrorState message={error} />
      </div>
    );
  }
  if (!form) return null;

  if (done) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <EmptyState
          icon={CheckCircle2}
          title="Thank you — your feedback has been submitted"
          description={`${row.course_code} · ${TYPE_LABEL[row.feedback_type]}. Your response is recorded without your name.`}
        />
      </div>
    );
  }

  const sections = form.sections ?? [];

  return (
    <div className="space-y-5">
      <BackButton onBack={onBack} />

      {/* Course header — auto-filled, exactly as the faculty's form shows it */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">
            {row.course_code}
          </span>
          <span className="text-base font-semibold text-foreground">
            {row.course_title}
          </span>
        </div>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Feedback Type" value={`${TYPE_LABEL[row.feedback_type]} Feedback`} />
          <Field label="Course Coordinator" value={form.coordinator_name ?? "Not assigned"} />
          <Field label="Academic Year" value={form.academic_year ?? "—"} />
          <Field label="Date" value={new Date().toLocaleDateString()} />
        </dl>
      </div>

      <p className="rounded-xl border-l-4 border-primary bg-primary/5 px-4 py-3 text-sm text-foreground">
        We appreciate your feedback on the{" "}
        <strong>overall content and delivery methods</strong> of the course. The
        information provided is treated with <strong>high confidentiality</strong>{" "}
        for the improvement of future course delivery.
      </p>

      {!form.can_edit && (
        <p className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          You have already submitted this form and it can no longer be changed.
        </p>
      )}

      {error && <ErrorState message={error} size="inline" />}

      {sections.map((section) => (
        <SectionCardView
          key={section.key}
          section={section}
          form={form}
          answers={answers}
          disabled={disabled}
          onPatch={patch}
        />
      ))}

      <Button
        size="lg"
        className="w-full"
        disabled={disabled}
        onClick={submit}
      >
        {saving ? "Submitting…" : "Submit Feedback"}
      </Button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1.5 text-sm text-foreground">
        {value}
      </dd>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onBack}>
      <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
      Back to Course Selection
    </Button>
  );
}

/**
 * One section. A lecturer section is repeated once per lecturer actually
 * assigned to this delivery — the faculty's form asks the student to type the
 * name, which is how the same person ends up counted three ways.
 */
function SectionCardView({
  section,
  form,
  answers,
  disabled,
  onPatch,
}: {
  section: FeedbackSection;
  form: FeedbackFormData;
  answers: Record<string, FeedbackAnswerInput>;
  disabled: boolean;
  onPatch: (
    q: FeedbackQuestion,
    lecturerId: string | null,
    value: Partial<FeedbackAnswerInput>,
  ) => void;
}) {
  const perLecturer = section.target_type === "lecturer";

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <header className="mb-4 border-b border-border/70 pb-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          {section.icon && <span aria-hidden="true">{section.icon}</span>}
          {section.title}
        </h2>
        {section.description && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {section.description}
            {section.questions.some((q) => q.is_required) && (
              <> — all fields are required <span className="text-destructive">*</span></>
            )}
          </p>
        )}
      </header>

      {perLecturer ? (
        form.lecturers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No lecturer is recorded for this course, so there is nobody to rate.
          </p>
        ) : (
          <div className="space-y-5">
            {form.lecturers.map((lecturer, i) => (
              <div
                key={lecturer.lecturer_id}
                className="rounded-xl border border-border/70 bg-muted/20 p-3 sm:p-4"
              >
                <p className="text-sm font-semibold text-foreground">
                  Lecturer {i + 1}
                </p>
                <p className="mb-3 text-sm text-primary">
                  {lecturer.name}
                  {lecturer.assignment_role === "coordinator" && (
                    <StatusBadge tone="brand" className="ml-1.5">
                      Coordinator
                    </StatusBadge>
                  )}
                </p>
                <QuestionGroup
                  questions={section.questions}
                  lecturerId={lecturer.lecturer_id}
                  answers={answers}
                  disabled={disabled}
                  onPatch={onPatch}
                />
              </div>
            ))}
          </div>
        )
      ) : (
        <QuestionGroup
          questions={section.questions}
          lecturerId={null}
          answers={answers}
          disabled={disabled}
          onPatch={onPatch}
        />
      )}
    </section>
  );
}

/**
 * Renders a section's questions, collapsing consecutive rating statements into
 * one matrix and leaving everything else as its own control.
 */
function QuestionGroup({
  questions,
  lecturerId,
  answers,
  disabled,
  onPatch,
}: {
  questions: FeedbackQuestion[];
  lecturerId: string | null;
  answers: Record<string, FeedbackAnswerInput>;
  disabled: boolean;
  onPatch: (
    q: FeedbackQuestion,
    lecturerId: string | null,
    value: Partial<FeedbackAnswerInput>,
  ) => void;
}) {
  const visible = questions.filter((q) =>
    isQuestionVisible(q, answers, lecturerId),
  );

  /* Group into runs so a block of statements becomes one grid. */
  const blocks: { kind: "matrix" | "single"; items: FeedbackQuestion[] }[] = [];
  for (const q of visible) {
    const kind = q.question_type === "rating" ? "matrix" : "single";
    const last = blocks[blocks.length - 1];
    if (last && last.kind === "matrix" && kind === "matrix") last.items.push(q);
    else blocks.push({ kind, items: [q] });
  }

  return (
    <div className="space-y-4">
      {blocks.map((block, i) =>
        block.kind === "matrix" ? (
          <LikertMatrix
            key={i}
            questions={block.items}
            answers={answers}
            answerKeyFor={(q) => answerKey(q.id, lecturerId)}
            disabled={disabled}
            onChange={(q, value) => onPatch(q, lecturerId, { rating_value: value })}
          />
        ) : (
          block.items.map((q) => (
            <QuestionField
              key={answerKey(q.id, lecturerId)}
              question={q}
              answer={answers[answerKey(q.id, lecturerId)]}
              disabled={disabled}
              maxTextLength={MAX_TEXT}
              onChange={(value) => onPatch(q, lecturerId, value)}
            />
          ))
        ),
      )}
    </div>
  );
}
