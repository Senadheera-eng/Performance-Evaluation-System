import { cn } from "../ui/utils";
import type {
  FeedbackAnswerInput,
  FeedbackQuestion,
} from "../../../lib/feedbackService";

/**
 * The scale, in the order the faculty's form prints it: best on the left.
 * Stored high-to-low, so 5 is Strongly Agree everywhere in the system.
 */
export const LIKERT_COLUMNS: { value: number; label: string }[] = [
  { value: 5, label: "Strongly Agree" },
  { value: 4, label: "Agree" },
  { value: 3, label: "Neutral" },
  { value: 2, label: "Disagree" },
  { value: 1, label: "Strongly Disagree" },
];

/**
 * A run of rating statements as one grid, the way the paper form asks them.
 *
 * Asking fifteen statements one underneath the other turns a two-minute form
 * into a page of scrolling, and loses the thing a matrix gives you — the
 * scale stated once at the top, so every row is read against the same ruler.
 *
 * Rendered twice: a real table on a wide screen, and one card per statement
 * below `sm`, where five columns cannot fit without either shrinking the tap
 * targets or forcing the whole page sideways.
 */
export function LikertMatrix({
  questions,
  answers,
  answerKeyFor,
  disabled,
  onChange,
  missingKeys,
}: {
  questions: FeedbackQuestion[];
  answers: Record<string, FeedbackAnswerInput>;
  /** Course questions key on id alone; lecturer ones also on who they rate. */
  answerKeyFor: (question: FeedbackQuestion) => string;
  disabled: boolean;
  onChange: (question: FeedbackQuestion, value: number) => void;
  /** Required statements a submit found unanswered, to be marked. */
  missingKeys?: Set<string>;
}) {
  if (questions.length === 0) return null;

  const valueOf = (q: FeedbackQuestion) =>
    answers[answerKeyFor(q)]?.rating_value ?? null;
  const isMissing = (q: FeedbackQuestion) =>
    missingKeys?.has(answerKeyFor(q)) ?? false;

  return (
    <>
      {/* Wide screens: the grid, scale stated once. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-primary text-primary-foreground">
              <th className="rounded-l-lg px-3 py-2.5 text-left font-medium">
                Statement
              </th>
              {LIKERT_COLUMNS.map((col, i) => (
                <th
                  key={col.value}
                  scope="col"
                  className={cn(
                    "w-[92px] px-2 py-2.5 text-center text-xs font-medium leading-tight",
                    i === LIKERT_COLUMNS.length - 1 && "rounded-r-lg",
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {questions.map((q, row) => {
              const current = valueOf(q);
              const missing = isMissing(q);
              return (
                <tr
                  key={answerKeyFor(q)}
                  data-missing-answer={missing || undefined}
                  className={cn(
                    "border-b border-border/60 scroll-mt-24",
                    row % 2 === 1 && "bg-muted/40",
                    missing &&
                      "bg-red-50 outline outline-2 -outline-offset-2 outline-destructive/70 dark:bg-red-500/10",
                  )}
                >
                  <td className="px-3 py-2.5 text-foreground">
                    {q.question_text}
                    {q.is_required && (
                      <span className="ml-1 text-destructive">*</span>
                    )}
                    {missing && <MissingHint />}
                  </td>
                  {LIKERT_COLUMNS.map((col) => (
                    <td key={col.value} className="px-2 py-2.5 text-center">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={current === col.value}
                        aria-label={`${q.question_text} — ${col.label}`}
                        disabled={disabled}
                        onClick={() => onChange(q, col.value)}
                        className={cn(
                          "h-5 w-5 rounded-full border-2 align-middle transition-all",
                          "disabled:cursor-not-allowed disabled:opacity-60",
                          current === col.value
                            ? "border-primary bg-primary ring-2 ring-primary/25"
                            : "border-muted-foreground/40 hover:border-primary/60",
                        )}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Narrow screens: one statement per card, scale repeated as labels. */}
      <div className="space-y-3 sm:hidden">
        {questions.map((q) => {
          const current = valueOf(q);
          const missing = isMissing(q);
          return (
            <div
              key={answerKeyFor(q)}
              data-missing-answer={missing || undefined}
              className={cn(
                "scroll-mt-24 rounded-xl border p-3",
                missing
                  ? "border-2 border-destructive/70 bg-red-50 dark:bg-red-500/10"
                  : "border-border/70",
              )}
            >
              <p className="mb-2 text-sm text-foreground">
                {q.question_text}
                {q.is_required && <span className="ml-1 text-destructive">*</span>}
                {missing && <MissingHint />}
              </p>
              <div
                role="radiogroup"
                aria-label={q.question_text}
                className="flex justify-between gap-1"
              >
                {LIKERT_COLUMNS.map((col) => (
                  <button
                    key={col.value}
                    type="button"
                    role="radio"
                    aria-checked={current === col.value}
                    aria-label={col.label}
                    disabled={disabled}
                    onClick={() => onChange(q, col.value)}
                    className={cn(
                      "flex flex-1 flex-col items-center gap-1 rounded-lg border px-1 py-1.5 transition-all",
                      "disabled:cursor-not-allowed disabled:opacity-60",
                      current === col.value
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-4 w-4 rounded-full border-2",
                        current === col.value
                          ? "border-primary bg-primary"
                          : "border-muted-foreground/40",
                      )}
                    />
                    <span className="text-[10px] leading-tight text-muted-foreground">
                      {col.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Said in words as well as colour, so the mark does not rely on seeing red. */
export function MissingHint() {
  return (
    <span className="mt-0.5 block text-xs font-medium text-destructive">
      Answer required
    </span>
  );
}
