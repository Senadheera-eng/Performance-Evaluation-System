import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Lock,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  CourseCode,
  EmptyState,
  ErrorState,
  PageHeader,
  PersonAvatar,
  SectionCard,
  SkeletonRows,
  StatStrip,
  StatusBadge,
  StickyActionBar,
} from "../components/common";
import { LikertMatrix } from "../components/feedback/LikertMatrix";
import { QuestionField } from "../components/feedback/QuestionField";
import { cn } from "../components/ui/utils";
import { departmentByCourseCode } from "../../lib/departments";
import {
  answerKey,
  getFeedbackCatalogue,
  getFeedbackForm,
  isQuestionVisible,
  missingRequiredKeys,
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

  /* Forms still owed in each semester — what makes a semester worth opening,
     and the number the button shows. */
  const openInSemester = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of rows) {
      if (r.submission_status === "submitted") continue;
      map.set(r.semester, (map.get(r.semester) ?? 0) + 1);
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

  const owedTotal = rows.filter((r) => r.submission_status !== "submitted").length;
  const doneTotal = rows.length - owedTotal;
  /* The soonest deadline among the forms still owed. */
  const nextClose = rows
    .filter((r) => r.submission_status !== "submitted")
    .map((r) => r.closes_at)
    .sort()[0];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Course Feedback"
        description="Tell your department how a course went. Pick a semester, then a course: responses are recorded without your name and treated with strict confidentiality."
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
          <StatStrip
            items={[
              {
                icon: ClipboardList,
                value: owedTotal,
                label: owedTotal === 1 ? "form to fill in" : "forms to fill in",
                tone: owedTotal > 0 ? "brand" : "neutral",
              },
              { icon: CheckCircle2, value: doneTotal, label: "submitted", tone: "success" },
              ...(nextClose
                ? [{ icon: CalendarClock, value: shortDate(nextClose), label: "next deadline", tone: "warning" as const }]
                : []),
            ]}
          />

          <SectionCard title={<StepTitle number={1} title="Select your semester" />}>
            {/* One row of eight on a wide screen, two of four on a phone: the
                semester with forms waiting is the one that stands out. */}
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {SEMESTERS.map((s) => {
                const available = bySemester.has(s);
                const outstanding = openInSemester.get(s) ?? 0;
                const selected = semester === s;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={!available}
                    aria-pressed={selected}
                    aria-label={`${ORDINAL[s]} Semester, ${
                      !available ? "not available" : outstanding > 0 ? `${outstanding} open` : "all done"
                    }`}
                    onClick={() => {
                      setSemester(s);
                      setChosenCourse(null);
                    }}
                    className={cn(
                      "relative flex flex-col items-center rounded-control border px-1 py-2.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "border-primary bg-primary text-primary-foreground shadow-elevation-sm"
                        : outstanding > 0
                          ? // A semester with forms still to fill in is the whole
                            // reason the student came, so it carries the brand.
                            "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                          : available
                            ? "border-border bg-card text-foreground hover:border-primary/40"
                            : "cursor-not-allowed border-dashed border-border bg-transparent text-muted-foreground/60",
                    )}
                  >
                    {outstanding > 0 && !selected && (
                      <span
                        aria-hidden="true"
                        className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground ring-2 ring-card"
                      >
                        {outstanding}
                      </span>
                    )}
                    <span className="text-[11px] font-medium uppercase tracking-wide opacity-80">Sem</span>
                    <span className="text-xl font-bold leading-tight tabular-nums">{s}</span>
                    <span className="mt-0.5 text-[11px] leading-tight">
                      {!available ? "—" : outstanding > 0 ? `${outstanding} open` : "Done"}
                    </span>
                  </button>
                );
              })}
            </div>
          </SectionCard>

          {semester !== null && (
            <SectionCard
              title={<StepTitle number={2} title={`Select a course in Semester ${semester}`} />}
              flush
            >
              <ul className="divide-y divide-border/70">
                {coursesInSemester.map((c) => {
                  const rounds = rows.filter((r) => r.course_id === c.course_id);
                  const owedRounds = rounds.filter((r) => r.submission_status !== "submitted");
                  const owed = owedRounds.length;
                  const closes = owedRounds.map((r) => r.closes_at).sort()[0];
                  const dept = departmentByCourseCode(c.course_code);
                  return (
                    <li key={c.course_id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => {
                          setChosenCourse(c.course_id);
                          setChosenType(null);
                        }}
                        className={cn(
                          "group flex w-full min-w-0 items-center gap-3 border-l-4 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          dept?.stripeClass ?? "border-l-border",
                          dept?.hoverClass ?? "hover:bg-muted/50",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <CourseCode code={c.course_code} className="text-sm" />
                            <span className="min-w-0 text-sm font-medium text-foreground">
                              {c.course_title}
                            </span>
                          </span>
                          {closes && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              Closes {shortDate(closes)}
                            </span>
                          )}
                        </span>
                        {/* Says which courses still want an answer, not
                            only which are finished. */}
                        {owed === 0 ? (
                          <StatusBadge tone="success" icon={CheckCircle2}>
                            Done
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="info" dot>
                            {owed === 1 ? "1 form open" : `${owed} forms open`}
                          </StatusBadge>
                        )}
                        <ChevronRight
                          className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </SectionCard>
          )}
        </>
      )}

      <Dialog
        open={chosenCourse !== null}
        onOpenChange={(open) => !open && setChosenCourse(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Which round?</DialogTitle>
            {roundsForCourse[0] && (
              <DialogDescription>
                <CourseCode code={roundsForCourse[0].course_code} className="text-sm" />{" "}
                {roundsForCourse[0].course_title}
              </DialogDescription>
            )}
          </DialogHeader>

          <div role="radiogroup" aria-label="Feedback round" className="grid gap-2 sm:grid-cols-2">
            {(["mid_semester", "end_semester"] as const).map((type) => {
              const round = roundsForCourse.find((r) => r.feedback_type === type);
              const submitted = round?.submission_status === "submitted";
              const draft = round?.submission_status === "draft";
              const selected = chosenType === type;
              return (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  disabled={!round}
                  aria-checked={selected}
                  onClick={() => setChosenType(type)}
                  className={cn(
                    "relative flex flex-col items-start gap-1 rounded-control border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-inset ring-primary/30"
                      : round
                        ? "border-border bg-card hover:border-primary/40"
                        : "cursor-not-allowed border-dashed border-border bg-transparent",
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2",
                        selected ? "border-primary" : "border-muted-foreground/40",
                      )}
                    >
                      {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                    <span
                      className={cn(
                        "text-sm font-semibold",
                        round ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {TYPE_LABEL[type]}
                    </span>
                  </span>
                  <span className="pl-6 text-xs text-muted-foreground">
                    {round ? TYPE_WINDOW[type] : "Not available yet"}
                  </span>
                  {round && (
                    <span className="flex flex-wrap items-center gap-1.5 pl-6 pt-0.5">
                      {submitted ? (
                        <StatusBadge tone="success" icon={CheckCircle2}>
                          Already submitted
                        </StatusBadge>
                      ) : draft ? (
                        <StatusBadge tone="warning" dot>
                          Started
                        </StatusBadge>
                      ) : null}
                      {!submitted && (
                        <span className="text-xs text-muted-foreground">
                          Closes {shortDate(round.closes_at)}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setChosenCourse(null)}>
              Cancel
            </Button>
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
              Continue to the form
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "15 Nov", for a deadline. */
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** A step's number and name, as a card's title. */
function StepTitle({ number, title }: { number: number; title: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
      >
        {number}
      </span>
      {title}
    </span>
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
  /* Marks stay off until someone tries to submit: a form that opens with
     every question outlined in red reads as an error before anything has
     gone wrong. After that attempt they stay on, and each one clears the
     moment its question is answered. */
  const [showMissing, setShowMissing] = useState(false);

  const missingKeys = useMemo(
    () => (form ? missingRequiredKeys(form, answers) : []),
    [form, answers],
  );
  const missingSet = useMemo(
    () => (showMissing ? new Set(missingKeys) : undefined),
    [showMissing, missingKeys],
  );

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
        ...prev[key],
        ...value,
        /* Which question this answers is decided by the key, not by whatever
           a field sends: these were written first and then spread over, so
           the compiler could see they never survived. No field has ever sent
           them, so the answers are the same — they are simply now stated
           where they cannot be overwritten. */
        question_id: question.id,
        lecturer_target_id: lecturerId,
      },
    }));
  };

  /* The first unanswered question that is actually on screen. Each rating
     row exists twice — a table row for wide screens and a card for narrow
     ones — and only one of the pair is displayed, so the hidden twin is
     skipped. */
  const goToFirstMissing = () => {
    requestAnimationFrame(() => {
      const first = Array.from(
        document.querySelectorAll<HTMLElement>("[data-missing-answer]"),
      ).find((el) => el.offsetParent !== null);
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      first?.querySelector<HTMLElement>("button, input, textarea")?.focus({
        preventScroll: true,
      });
    });
  };

  const submit = async () => {
    if (!form) return;
    /* Checked here, by the same rules the database applies, so the page can
       point at the question. Left to the server alone, all a student got
       back was a count — "1 still to go" — and a form of forty questions to
       search by eye. */
    if (missingKeys.length > 0) {
      setError(null);
      setShowMissing(true);
      goToFirstMissing();
      return;
    }
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
          description={
            <>
              <CourseCode code={row.course_code} /> · {TYPE_LABEL[row.feedback_type]}. Your
              response is recorded without your name.
            </>
          }
        />
      </div>
    );
  }

  const sections = form.sections ?? [];
  const dept = departmentByCourseCode(row.course_code);

  return (
    /* Room at the bottom for the submit bar, so it never covers the last
       question. */
    <div className="space-y-5 pb-28">
      <BackButton onBack={onBack} />

      {/* Course header — auto-filled, with what the faculty's form shows. */}
      <section
        className={cn(
          "rounded-card border border-l-4 border-border bg-card p-4 shadow-elevation-sm sm:p-5",
          dept?.stripeClass,
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="brand">{TYPE_LABEL[row.feedback_type]} Feedback</StatusBadge>
          {form.closes_at && form.can_edit && (
            <span className="text-xs text-muted-foreground">
              Closes {shortDate(form.closes_at)}
            </span>
          )}
        </div>
        <h2 className="mt-2 flex flex-wrap items-baseline gap-x-2 text-lg font-semibold text-foreground">
          <CourseCode code={row.course_code} className="text-base" />
          <span>{row.course_title}</span>
        </h2>
        {/* The feedback type is the badge above, so it is not repeated. */}
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border/70 pt-4 text-sm sm:grid-cols-3">
          <Field label="Course coordinator" value={form.coordinator_name ?? "Not assigned"} />
          <Field label="Academic year" value={form.academic_year ?? "—"} />
          <Field
            label="Date"
            value={new Date().toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          />
        </dl>
      </section>

      <p className="flex items-start gap-2.5 rounded-control border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
        <span>
          We appreciate your feedback on the{" "}
          <strong>overall content and delivery methods</strong> of the course. The
          information provided is treated with <strong>high confidentiality</strong>{" "}
          for the improvement of future course delivery.
        </span>
      </p>

      {!form.can_edit && (
        <p className="flex items-center gap-2 rounded-control border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          You have already submitted this form and it can no longer be changed.
        </p>
      )}

      {error && <ErrorState message={error} size="inline" />}

      {sections.map((section, i) => (
        <SectionCardView
          key={section.key}
          number={i + 1}
          section={section}
          form={form}
          answers={answers}
          disabled={disabled}
          onPatch={patch}
          missingKeys={missingSet}
        />
      ))}

      {showMissing && (
        <MissingSummary count={missingKeys.length} onShow={goToFirstMissing} />
      )}

      {/* The submit button stays in reach on a long form, with how many
          required answers are left — in plain words until a submit has been
          tried, after which the questions themselves are marked. */}
      <StickyActionBar
        open={form.can_edit}
        summary={
          missingKeys.length === 0 ? (
            <span className="flex items-center gap-2 text-success-fg">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              Every required question is answered.
            </span>
          ) : (
            <span className="text-muted-foreground">
              <strong className="tabular-nums text-foreground">{missingKeys.length}</strong>{" "}
              required question{missingKeys.length === 1 ? "" : "s"} left
              <button
                type="button"
                onClick={() => {
                  setShowMissing(true);
                  goToFirstMissing();
                }}
                className="ml-2 text-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                Show the next one
              </button>
            </span>
          )
        }
      >
        <Button disabled={disabled} onClick={submit}>
          {saving ? "Submitting…" : "Submit Feedback"}
        </Button>
      </StickyActionBar>
    </div>
  );
}

/**
 * Next to the submit button, because that is where the student is looking
 * when they find out. Says how many are left and takes them to the first.
 */
function MissingSummary({
  count,
  onShow,
}: {
  count: number;
  onShow: () => void;
}) {
  if (count === 0) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-control border border-success-border bg-success-bg px-4 py-3 text-sm text-success-fg"
      >
        <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        All required questions are answered. You can submit now.
      </p>
    );
  }
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-control border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg"
    >
      <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <span className="flex-1">
        {count === 1
          ? "1 required question is still unanswered. It is marked in red above."
          : `${count} required questions are still unanswered. They are marked in red above.`}
      </span>
      <Button size="sm" variant="outline" onClick={onShow}>
        Show me
      </Button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-medium text-foreground">{value}</dd>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
      <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
      Back to courses
    </Button>
  );
}

/**
 * One section. A lecturer section is repeated once per lecturer actually
 * assigned to this delivery — the faculty's form asks the student to type the
 * name, which is how the same person ends up counted three ways.
 */
function SectionCardView({
  number,
  section,
  form,
  answers,
  disabled,
  onPatch,
  missingKeys,
}: {
  number: number;
  section: FeedbackSection;
  form: FeedbackFormData;
  answers: Record<string, FeedbackAnswerInput>;
  disabled: boolean;
  onPatch: (
    q: FeedbackQuestion,
    lecturerId: string | null,
    value: Partial<FeedbackAnswerInput>,
  ) => void;
  missingKeys?: Set<string>;
}) {
  const perLecturer = section.target_type === "lecturer";
  /* How many of the marked questions are in this section, so a student
     scrolling past it can tell it still needs something. */
  const sectionIds = new Set(section.questions.map((q) => q.id));
  const missingHere = missingKeys
    ? [...missingKeys].filter((k) => sectionIds.has(k.split("::")[0])).length
    : 0;

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
          >
            {number}
          </span>
          {section.icon && <span aria-hidden="true">{section.icon}</span>}
          {section.title}
        </span>
      }
      // Stored as written on the faculty's form. Composing the "all fields
      // are required" half here got it wrong for the two sections whose
      // follow-ups are optional.
      description={section.description ?? undefined}
      actions={
        missingHere > 0 ? (
          <StatusBadge tone="danger">{missingHere} to answer</StatusBadge>
        ) : undefined
      }
    >
      {perLecturer ? (
        form.lecturers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No lecturer is recorded for this course, so there is nobody to rate.
          </p>
        ) : (
          <div className="space-y-4">
            {form.lecturers.map((lecturer, i) => (
              <div
                key={lecturer.lecturer_id}
                className="rounded-control border border-border/70 bg-muted/20 p-3 sm:p-4"
              >
                <div className="mb-3 flex items-center gap-3">
                  <PersonAvatar name={lecturer.name} department={form.course?.department} size="sm" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
                      {lecturer.name}
                      {lecturer.assignment_role === "coordinator" && (
                        <StatusBadge tone="brand">Coordinator</StatusBadge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Lecturer {i + 1} of {form.lecturers.length}
                    </p>
                  </div>
                </div>
                <QuestionGroup
                  questions={section.questions}
                  lecturerId={lecturer.lecturer_id}
                  answers={answers}
                  disabled={disabled}
                  onPatch={onPatch}
                  missingKeys={missingKeys}
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
          missingKeys={missingKeys}
        />
      )}
    </SectionCard>
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
  missingKeys,
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
  missingKeys?: Set<string>;
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
            missingKeys={missingKeys}
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
              missing={missingKeys?.has(answerKey(q.id, lecturerId)) ?? false}
            />
          ))
        ),
      )}
    </div>
  );
}
