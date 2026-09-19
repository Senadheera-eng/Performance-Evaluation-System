import { useEffect, useState } from "react";
import { Info, ListPlus, Lock, Plus, Trash2, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import {
  ErrorState,
  SectionCard,
  SkeletonRows,
  StatusBadge,
} from "../common";
import {
  addCourseQuestion,
  getMyCoordinatedFeedback,
  removeCourseQuestion,
  type CoordinatedRound,
} from "../../../lib/staffService";

const TYPES: { value: string; label: string }[] = [
  { value: "rating", label: "Rating 1–5" },
  { value: "yes_no", label: "Yes / No" },
  { value: "single_choice", label: "Choose one" },
  { value: "short_text", label: "Short answer" },
  { value: "long_text", label: "Long answer" },
];

const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

const toValue = (label: string) =>
  label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/**
 * Questions a course coordinator adds to their own subject.
 *
 * The department's form is the same for every course in a round; this is the
 * part that is not. A question added here carries the course on it, so it
 * reaches that course's students and nobody else's — which is the whole reason
 * the link between a question and a round had to learn about courses at all.
 *
 * Only the sitting coordinator of the offering can add one, and the database
 * checks that itself rather than trusting this screen.
 */
export function CoordinatorQuestions() {
  const [rounds, setRounds] = useState<CoordinatedRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [composing, setComposing] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    const result = await getMyCoordinatedFeedback();
    if (!result.ok) {
      setError("We could not load your courses' feedback rounds.");
      setLoading(false);
      return;
    }
    setRounds(result.data);
    setLoading(false);
  };

  const act = async (
    key: string,
    run: () => Promise<{ ok: boolean; data?: { message: string }; error?: string }>,
  ) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    const result = await run();
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? "That did not work.");
      return false;
    }
    await load();
    setNotice(result.data?.message ?? "Done.");
    return true;
  };

  if (!loading && rounds.length === 0) return null;

  return (
    <div className="space-y-4">
      {notice && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </div>
      )}
      {error && <ErrorState message={error} onRetry={load} size="inline" />}

      <SectionCard
        title="Your own questions"
        description="Ask your students something the department's form does not. Only your course sees it."
        flush
      >
        {loading ? (
          <div className="p-4">
            <SkeletonRows count={2} height="h-16" />
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {rounds.map((round) => {
              const key = `${round.period_id}:${round.course_id}`;
              return (
                <li key={key} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-primary">
                          {round.course_code}
                        </span>
                        <span className="truncate text-sm text-foreground">
                          {round.course_title}
                        </span>
                        <StatusBadge tone="brand">Coordinator</StatusBadge>
                        {round.can_edit_questions ? (
                          <StatusBadge tone="warning">Draft</StatusBadge>
                        ) : (
                          <StatusBadge tone="neutral" icon={Lock}>
                            Form fixed
                          </StatusBadge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {round.period_title} ·{" "}
                        {round.feedback_type === "mid_semester"
                          ? "Mid semester"
                          : "End semester"}{" "}
                        · closes{" "}
                        {new Date(round.closes_at).toLocaleDateString()} ·{" "}
                        {round.response_count} response
                        {round.response_count === 1 ? "" : "s"} so far
                      </p>
                      {!round.can_edit_questions && (
                        // The window for shaping the form is the draft. Once
                        // the department opens it, every student has to be
                        // answering the same questions.
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Your department has opened this round, so its
                          questions are now fixed.
                        </p>
                      )}
                    </div>
                    {round.can_edit_questions && (
                      <Button
                        size="sm"
                        variant={composing === key ? "outline" : "default"}
                        disabled={busy !== null}
                        onClick={() =>
                          setComposing(composing === key ? null : key)
                        }
                      >
                        {composing === key ? (
                          <>
                            <X className="mr-1.5 h-3.5 w-3.5" />
                            Cancel
                          </>
                        ) : (
                          <>
                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                            Add a question
                          </>
                        )}
                      </Button>
                    )}
                  </div>

                  {round.my_questions.length > 0 && (
                    <ul className="mt-2.5 space-y-1.5">
                      {round.my_questions.map((q) => (
                        <li
                          key={q.id}
                          className="flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2"
                        >
                          <span className="min-w-0">
                            <span className="text-sm text-foreground">
                              {q.question_text}
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              <StatusBadge tone="neutral">
                                {TYPE_LABEL[q.question_type] ?? q.question_type}
                              </StatusBadge>
                              {!q.is_required && (
                                <StatusBadge tone="neutral">Optional</StatusBadge>
                              )}
                            </span>
                          </span>
                          {round.can_edit_questions && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy !== null}
                              onClick={() =>
                                act(`rm-${q.id}`, () =>
                                  removeCourseQuestion(
                                    round.period_id,
                                    round.course_id,
                                    q.id,
                                  ),
                                )
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span className="sr-only">Remove</span>
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {composing === key && (
                    <QuestionComposer
                      responseCount={round.response_count}
                      busy={busy !== null}
                      onSubmit={async (draft) => {
                        const ok = await act(`add-${key}`, () =>
                          addCourseQuestion({
                            periodId: round.period_id,
                            courseId: round.course_id,
                            ...draft,
                          }),
                        );
                        if (ok) setComposing(null);
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function QuestionComposer({
  responseCount,
  busy,
  onSubmit,
}: {
  responseCount: number;
  busy: boolean;
  onSubmit: (draft: {
    questionText: string;
    questionType: string;
    options: { value: string; label: string }[] | null;
    placeholder: string | null;
    isRequired: boolean;
  }) => void;
}) {
  const [text, setText] = useState("");
  const [type, setType] = useState("rating");
  const [labels, setLabels] = useState<string[]>(["", ""]);
  const [required, setRequired] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const isChoice = type === "single_choice";

  const submit = () => {
    if (!text.trim()) return setProblem("Write the question first.");
    const options = isChoice
      ? labels
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => ({ value: toValue(l), label: l }))
      : null;
    if (isChoice && (options?.length ?? 0) < 2) {
      return setProblem("A choice question needs at least two options.");
    }
    setProblem(null);
    onSubmit({
      questionText: text.trim(),
      questionType: type,
      options,
      placeholder: null,
      isRequired: required,
    });
  };

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-border/70 bg-card p-3">
      {problem && <ErrorState message={problem} size="inline" />}

      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. The group project brief was clear"
      />

      <div className="flex flex-wrap gap-1.5">
        {TYPES.map((t) => (
          <Button
            key={t.value}
            type="button"
            size="sm"
            variant={type === t.value ? "default" : "outline"}
            onClick={() => setType(t.value)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {isChoice && (
        <div className="space-y-2">
          {labels.map((label, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={label}
                onChange={(e) =>
                  setLabels((prev) =>
                    prev.map((l, j) => (j === i ? e.target.value : l)),
                  )
                }
                placeholder={`Option ${i + 1}`}
              />
              {labels.length > 2 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setLabels((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setLabels((prev) => [...prev, ""])}
          >
            <ListPlus className="mr-1.5 h-3.5 w-3.5" />
            Add option
          </Button>
        </div>
      )}

      <label className="flex cursor-pointer items-start gap-2.5">
        <Checkbox
          className="mt-0.5"
          checked={required}
          disabled={responseCount > 0}
          onCheckedChange={(v) => setRequired(v === true)}
        />
        <span>
          <span className="text-sm text-foreground">Students must answer it</span>
          {responseCount > 0 && (
            <span className="mt-0.5 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              Not available — {responseCount} student
              {responseCount === 1 ? " has" : "s have"} already submitted this
              form, and a question added now cannot make their answers
              incomplete.
            </span>
          )}
        </span>
      </label>

      <Button size="sm" disabled={busy} onClick={submit}>
        {busy ? "Adding…" : "Add to my course"}
      </Button>
    </div>
  );
}
