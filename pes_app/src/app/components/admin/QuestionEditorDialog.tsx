import { useEffect, useState } from "react";
import { GripVertical, Plus, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { ErrorState, StatusBadge } from "../common";
import type {
  FeedbackOption,
  FeedbackQuestion,
  FeedbackQuestionType,
  QuestionDraft,
} from "../../../lib/feedbackService";

/* Radix's Select cannot hold an empty value, so "no gate" has its own. */
const ALWAYS = "__always__";

const TYPES: { value: FeedbackQuestionType; label: string; hint: string }[] = [
  { value: "rating", label: "Rating 1–5", hint: "Strongly Disagree → Strongly Agree" },
  { value: "single_choice", label: "Choose one", hint: "Named options you define" },
  { value: "yes_no", label: "Yes / No", hint: "Can reveal other questions" },
  { value: "short_text", label: "Short answer", hint: "A line or two" },
  { value: "long_text", label: "Long answer", hint: "A paragraph" },
];

/** A stable machine value from a human label, so admins only type the label. */
const toValue = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const emptyDraft = (): QuestionDraft => ({
  question_text: "",
  question_type: "rating",
  target_type: "course",
  section_key: null,
  section_title: "",
  section_order: 0,
  category: null,
  is_required: true,
  options: null,
  depends_on_question_id: null,
  depends_on_values: null,
});

/**
 * Full question editor.
 *
 * Everything the question model supports is reachable from here — options,
 * lecturer targeting, sections, and the gate that makes a question
 * conditional. Before this, those could only be set in SQL, which meant the
 * faculty's own form could not actually be built through the interface that
 * is supposed to build it.
 */
export function QuestionEditorDialog({
  open,
  onOpenChange,
  existing,
  bank,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null when creating. */
  existing: FeedbackQuestion | null;
  /** The rest of the bank, for choosing a gate question. */
  bank: FeedbackQuestion[];
  onSave: (draft: QuestionDraft) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [draft, setDraft] = useState<QuestionDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDraft(
      existing
        ? {
            question_text: existing.question_text,
            question_type: existing.question_type,
            target_type: existing.target_type,
            section_key: existing.section_key,
            section_title: existing.section_title ?? existing.category ?? "",
            section_order: existing.section_order,
            category: existing.category,
            is_required: existing.is_required,
            options: existing.options,
            depends_on_question_id: existing.depends_on_question_id,
            depends_on_values: existing.depends_on_values,
          }
        : emptyDraft(),
    );
  }, [open, existing]);

  const set = <K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const isChoice = draft.question_type === "single_choice";
  const options = draft.options ?? [];

  const setOption = (index: number, patch: Partial<FeedbackOption>) => {
    const next = options.map((o, i) =>
      i === index
        ? {
            ...o,
            ...patch,
            // The value follows the label unless it has been set already,
            // so an admin never has to think about machine keys.
            value: patch.label !== undefined ? toValue(patch.label) : o.value,
          }
        : o,
    );
    set("options", next);
  };

  // Only a question with fixed answers can gate another one.
  const gateCandidates = bank.filter(
    (q) =>
      q.id !== existing?.id &&
      (q.question_type === "yes_no" || q.question_type === "single_choice"),
  );
  const gate = gateCandidates.find((q) => q.id === draft.depends_on_question_id);
  const gateOptions: FeedbackOption[] =
    gate?.question_type === "yes_no"
      ? [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]
      : (gate?.options ?? []);

  const handleSave = async () => {
    setError(null);
    if (!draft.question_text.trim()) {
      setError("Enter the question text.");
      return;
    }
    if (isChoice) {
      const filled = options.filter((o) => o.label.trim());
      if (filled.length < 2) {
        setError("A choose-one question needs at least two options.");
        return;
      }
      if (new Set(filled.map((o) => o.value)).size !== filled.length) {
        setError("Two options resolve to the same value — reword one of them.");
        return;
      }
      draft.options = filled;
    }
    if (draft.depends_on_question_id && !(draft.depends_on_values?.length)) {
      setError("Choose which answers reveal this question.");
      return;
    }

    setSaving(true);
    const result = await onSave(draft);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "That question could not be saved.");
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit question" : "New question"}</DialogTitle>
          <DialogDescription>
            Questions live in a shared bank and can be added to any feedback
            period.
          </DialogDescription>
        </DialogHeader>

        {/* min-w-0: a long question named in the gate picker must not
            widen the dialog past a phone's edge. */}
        <div className="min-w-0 space-y-4">
          <div>
            <Label htmlFor="question-text" className="mb-1.5 block">
              Question <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="question-text"
              value={draft.question_text}
              onChange={(e) => set("question_text", e.target.value)}
              rows={2}
              placeholder="e.g. The course content was relevant and interesting"
            />
          </div>

          <div>
            <p id="question-type-label" className="mb-1.5 text-sm font-medium text-foreground">
              Answer type
            </p>
            <div role="group" aria-labelledby="question-type-label" className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {TYPES.map((t) => {
                const active = draft.question_type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      set("question_type", t.value);
                      if (t.value === "single_choice" && !draft.options?.length) {
                        set("options", [
                          { value: "", label: "" },
                          { value: "", label: "" },
                        ]);
                      }
                    }}
                    className={`rounded-control border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      active
                        ? "border-primary bg-primary/10 ring-1 ring-inset ring-primary/30"
                        : "border-border bg-card hover:border-primary/40 hover:bg-muted/50"
                    }`}
                  >
                    <span className="block text-sm font-medium text-foreground">
                      {t.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {isChoice && (
            <div>
              <p className="mb-1.5 text-sm font-medium text-foreground">
                Options <span className="text-destructive">*</span>
              </p>
              <div className="space-y-1.5">
                {options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <GripVertical
                      className="h-4 w-4 flex-shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      value={opt.label}
                      onChange={(e) => setOption(i, { label: e.target.value })}
                      placeholder={`Option ${i + 1} — e.g. Fully Physical`}
                      aria-label={`Option ${i + 1}`}
                      className="h-9"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        set("options", options.filter((_, idx) => idx !== i))
                      }
                      disabled={options.length <= 2}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-bg hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
                      aria-label={`Remove option ${i + 1}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => set("options", [...options, { value: "", label: "" }])}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add option
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="question-section" className="mb-1.5 block">
                Section
              </Label>
              <Input
                id="question-section"
                value={draft.section_title ?? ""}
                onChange={(e) => set("section_title", e.target.value)}
                placeholder="e.g. Learning Resources"
                className="h-9"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Questions with the same section appear together.
              </p>
            </div>
            <div>
              <Label htmlFor="question-section-order" className="mb-1.5 block">
                Section position
              </Label>
              <Input
                id="question-section-order"
                type="number"
                min={0}
                value={draft.section_order}
                onChange={(e) => set("section_order", Number(e.target.value) || 0)}
                className="h-9"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Lower numbers come first on the form.
              </p>
            </div>
          </div>

          <div>
            <p id="question-target-label" className="mb-1.5 text-sm font-medium text-foreground">
              Asked about
            </p>
            <div role="group" aria-labelledby="question-target-label" className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {(
                [
                  {
                    value: "course" as const,
                    label: "The course",
                    hint: "Asked once",
                  },
                  {
                    value: "lecturer" as const,
                    label: "Each lecturer",
                    hint: "Repeated per lecturer teaching it",
                  },
                ]
              ).map((t) => {
                const active = draft.target_type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => set("target_type", t.value)}
                    className={`rounded-control border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      active
                        ? "border-primary bg-primary/10 ring-1 ring-inset ring-primary/30"
                        : "border-border bg-card hover:border-primary/40 hover:bg-muted/50"
                    }`}
                  >
                    <span className="block text-sm font-medium text-foreground">
                      {t.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-control border border-border bg-muted/30 p-3">
            <p className="mb-1.5 text-sm font-medium text-foreground">
              Only show this question when…
            </p>
            {gateCandidates.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Add a Yes/No or choose-one question first — those are what can
                reveal another question.
              </p>
            ) : (
              <div className="space-y-2">
                <Select
                  value={draft.depends_on_question_id ?? ALWAYS}
                  onValueChange={(v) => {
                    set("depends_on_question_id", v === ALWAYS ? null : v);
                    set("depends_on_values", null);
                  }}
                >
                  <SelectTrigger
                    aria-label="Question that reveals this one"
                    className="h-9 w-full min-w-0 rounded-control border-border bg-card [&_[data-slot=select-value]]:min-w-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-w-[min(40rem,calc(100vw-2rem))]">
                    <SelectItem value={ALWAYS}>Always show it</SelectItem>
                    {gateCandidates.map((q) => (
                      <SelectItem key={q.id} value={q.id}>
                        <span className="truncate">{q.question_text}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {gate && (
                  <div className="flex flex-wrap gap-1.5">
                    {gateOptions.map((opt) => {
                      const selected =
                        draft.depends_on_values?.includes(opt.value) ?? false;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => {
                            const current = draft.depends_on_values ?? [];
                            set(
                              "depends_on_values",
                              selected
                                ? current.filter((v) => v !== opt.value)
                                : [...current, opt.value],
                            );
                          }}
                          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                            selected
                              ? "border-primary bg-primary/10 font-medium text-primary"
                              : "border-border bg-card text-muted-foreground hover:border-primary/40"
                          }`}
                        >
                          is “{opt.label}”
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.is_required}
              onCheckedChange={(v) => set("is_required", Boolean(v))}
            />
            Students must answer this
            {draft.depends_on_question_id && (
              <StatusBadge tone="neutral">only when shown</StatusBadge>
            )}
          </label>

          {error && <ErrorState message={error} size="inline" />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : existing ? "Save changes" : "Add question"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
