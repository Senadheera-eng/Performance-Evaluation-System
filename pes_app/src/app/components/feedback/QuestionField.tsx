import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { cn } from "../ui/utils";
import type {
  FeedbackAnswerInput,
  FeedbackQuestion,
} from "../../../lib/feedbackService";

export const RATING_LABELS: Record<number, string> = {
  1: "Strongly Disagree",
  2: "Disagree",
  3: "Neutral",
  4: "Agree",
  5: "Strongly Agree",
};

const YES_NO: { value: string; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/**
 * One question, rendered for its type.
 *
 * Every type writes through the same `onChange(patch)` shape, so the form
 * above does not need to know which control it is dealing with — only which
 * key the answer belongs under.
 */
export function QuestionField({
  question,
  answer,
  disabled,
  maxTextLength,
  onChange,
}: {
  question: FeedbackQuestion;
  answer: FeedbackAnswerInput | undefined;
  disabled: boolean;
  maxTextLength: number;
  onChange: (patch: Partial<FeedbackAnswerInput>) => void;
}) {
  const required = question.is_required;

  const label = (
    <Label className="mb-2 block text-sm font-medium text-foreground">
      {question.question_text}
      {required && <span className="ml-1 text-destructive">*</span>}
    </Label>
  );

  if (question.question_type === "rating") {
    const current = answer?.rating_value ?? null;
    return (
      <div>
        {label}
        <div
          role="radiogroup"
          aria-label={question.question_text}
          className="flex flex-wrap items-center gap-2"
        >
          {[1, 2, 3, 4, 5].map((val) => {
            const active = current === val;
            return (
              <button
                key={val}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={RATING_LABELS[val]}
                title={RATING_LABELS[val]}
                disabled={disabled}
                onClick={() => onChange({ rating_value: val })}
                className={cn(
                  "h-11 w-11 rounded-full border-2 text-sm font-semibold transition-all",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-elevation-sm"
                    : "border-border text-muted-foreground hover:border-primary/50",
                )}
              >
                {val}
              </button>
            );
          })}
          {current !== null && (
            <span className="ml-1 text-xs text-muted-foreground">
              {RATING_LABELS[current]}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (question.question_type === "single_choice" || question.question_type === "yes_no") {
    const options =
      question.question_type === "yes_no" ? YES_NO : (question.options ?? []);
    const current = answer?.choice_value ?? null;
    return (
      <div>
        {label}
        <div
          role="radiogroup"
          aria-label={question.question_text}
          className="flex flex-wrap gap-2"
        >
          {options.map((opt) => {
            const active = current === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => onChange({ choice_value: opt.value })}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  active
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-border text-foreground hover:border-primary/40",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-3.5 w-3.5 flex-shrink-0 rounded-full border-2",
                    active ? "border-primary bg-primary" : "border-muted-foreground/40",
                  )}
                />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const value = answer?.text_value ?? "";
  return (
    <div>
      {label}
      <Textarea
        value={value}
        onChange={(e) => {
          if (e.target.value.length > maxTextLength) return;
          onChange({ text_value: e.target.value });
        }}
        disabled={disabled}
        rows={question.question_type === "short_text" ? 2 : 3}
        placeholder={disabled ? "" : "Share your thoughts..."}
      />
      <p className="mt-1 text-right text-xs text-muted-foreground">
        {value.length}/{maxTextLength}
      </p>
    </div>
  );
}
