import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Eye,
  GripVertical,
  Lock,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Checkbox } from "../../components/ui/checkbox";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SkeletonRows,
  StatusBadge,
} from "../../components/common";
import { QuestionField } from "../../components/feedback/QuestionField";
import { describeBatch } from "../../../lib/batch";
import type {
  FeedbackOption,
  FeedbackQuestionType,
} from "../../../lib/feedbackService";
import {
  deleteCourseFormQuestion,
  getCourseFormEditor,
  reorderFormSections,
  saveCourseFormQuestion,
  saveFormSection,
  type CourseFormEditor,
  type EditorQuestion,
  type EditorSection,
} from "../../../lib/feedbackForm";

const TYPES: { value: FeedbackQuestionType; label: string }[] = [
  { value: "rating", label: "Rating 1–5" },
  { value: "yes_no", label: "Yes / No" },
  { value: "single_choice", label: "Choose one" },
  { value: "multi_select", label: "Pick several" },
  { value: "short_text", label: "Short answer" },
  { value: "long_text", label: "Long answer" },
];

const needsOptions = (t: FeedbackQuestionType) =>
  t === "single_choice" || t === "multi_select";

interface Draft {
  text: string;
  type: FeedbackQuestionType;
  options: string;
  placeholder: string;
  required: boolean;
}

const draftFrom = (q: EditorQuestion): Draft => ({
  text: q.question_text,
  type: q.question_type,
  options: (q.options ?? []).map((o) => o.label).join("\n"),
  placeholder: q.placeholder ?? "",
  required: q.is_required,
});

const emptyDraft = (): Draft => ({
  text: "",
  type: "rating",
  options: "",
  placeholder: "",
  required: false,
});

/** Options are typed one per line; the stored value is derived from the label. */
const parseOptions = (draft: Draft): FeedbackOption[] | null =>
  needsOptions(draft.type)
    ? draft.options
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((label) => ({
          label,
          value: label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        }))
    : null;

/**
 * The feedback form for one course, as its lecturer shapes it.
 *
 * Laid out as the student will meet it, top to bottom, with every question
 * shown through the very control the student will answer — the same
 * QuestionField the student's form renders. Nobody should have to imagine
 * what they are building.
 *
 * Everything here belongs to this course alone. A round's questions start as
 * the department's template; the first edit gives this course its own copy of
 * it, so renaming a section, rewording a question or moving a section can
 * never reach another lecturer's form. The database does the copying, and
 * refuses any change once the round is no longer a draft.
 */
export default function FeedbackFormEditor() {
  const { periodId, courseId } = useParams<{
    periodId: string;
    courseId: string;
  }>();
  const navigate = useNavigate();

  const [form, setForm] = useState<CourseFormEditor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!periodId || !courseId) return;
    const result = await getCourseFormEditor(periodId, courseId);
    if (!result.ok) {
      setError(result.error);
      setForm(null);
    } else {
      setError(null);
      setForm(result.data);
    }
    setLoading(false);
  }, [periodId, courseId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  /** Every change goes through here: run it, reload, say what happened. */
  const mutate = async (
    action: () => Promise<{ ok: boolean; error?: string; data?: string }>,
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await action();
    if (!result.ok) {
      setBusy(false);
      setError(result.error ?? "That did not work. Please try again.");
      return false;
    }
    await load();
    setBusy(false);
    setNotice(result.data ?? "Saved.");
    return true;
  };

  const saveQuestion = (
    questionId: string | null,
    draft: Draft,
    sectionTitle: string,
    sectionOrder: number,
    displayOrder: number,
  ) => {
    if (!periodId || !courseId) return Promise.resolve(false);
    if (!draft.text.trim()) {
      setError("Give the question some text.");
      return Promise.resolve(false);
    }
    const options = parseOptions(draft);
    if (needsOptions(draft.type) && (options?.length ?? 0) === 0) {
      setError("A choice question needs at least one option.");
      return Promise.resolve(false);
    }
    return mutate(() =>
      saveCourseFormQuestion(periodId, courseId, {
        questionId,
        questionText: draft.text,
        questionType: draft.type,
        options,
        placeholder: draft.placeholder.trim() || null,
        isRequired: draft.required,
        sectionTitle,
        sectionOrder,
        displayOrder,
      }),
    );
  };

  /** Move a section one place, or to where it was dropped. */
  const moveSection = (from: number, to: number) => {
    if (!form || !periodId || !courseId) return;
    if (to < 0 || to >= form.sections.length || from === to) return;
    const keys = form.sections.map((s) => s.section_key);
    const [moved] = keys.splice(from, 1);
    keys.splice(to, 0, moved);
    void mutate(() => reorderFormSections(periodId, courseId, keys));
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader title="Feedback form" />
        <SectionCard title="Loading">
          <SkeletonRows count={5} height="h-12" />
        </SectionCard>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="space-y-5">
        <PageHeader title="Feedback form" />
        <EmptyState
          icon={Lock}
          title="This form is not yours to open"
          description={
            error ??
            "You can only shape the form for a course you teach in this round."
          }
          action={
            <Button variant="outline" onClick={() => navigate("/staff/feedback")}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back to feedback
            </Button>
          }
        />
      </div>
    );
  }

  const canEdit = form.can_edit;

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        onClick={() => navigate("/staff/feedback")}
      >
        <ArrowLeft className="mr-1.5 h-4 w-4" />
        Back to feedback
      </Button>

      <PageHeader
        title={`${form.course_code} — ${form.course_title}`}
        description={`${form.period_title} · ${
          form.semester ? `Semester ${form.semester} · ` : ""
        }${form.batch_year ? describeBatch(form.batch_year) : "All batches"}`}
        actions={
          canEdit ? (
            <StatusBadge tone="warning">Draft — you can still edit</StatusBadge>
          ) : (
            <StatusBadge tone="neutral" icon={Lock}>
              {form.period_status === "open" ? "Open — fixed" : "Closed"}
            </StatusBadge>
          )
        }
      />

      {notice && (
        <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2 text-sm text-success-fg">
          {notice}
        </div>
      )}
      {error && <ErrorState message={error} size="inline" />}

      <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
        <Eye className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        {canEdit
          ? "This is the form as your students will see it, and it belongs to this course alone. Anything you change here — a question, a section title, the order — reaches nobody else's form. It stops being editable when your department opens the round."
          : "This is the form as your students see it. The round is no longer a draft, so it cannot be changed."}
      </p>

      {form.sections.length === 0 && (
        <SectionCard title="Nothing on this form yet">
          <p className="text-sm text-muted-foreground">
            Your department has not added its questions yet. Anything you add
            here will sit after them.
          </p>
        </SectionCard>
      )}

      {form.sections.map((section, index) => (
        <SectionBlock
          key={section.section_key}
          section={section}
          index={index}
          total={form.sections.length}
          canEdit={canEdit}
          busy={busy}
          dragging={dragging === section.section_key}
          dragOver={dragOver === section.section_key && dragging !== section.section_key}
          onDragStart={() => setDragging(section.section_key)}
          onDragEnd={() => {
            setDragging(null);
            setDragOver(null);
          }}
          onDragOverSection={() => setDragOver(section.section_key)}
          onDropOn={() => {
            setDragOver(null);
            if (!dragging || dragging === section.section_key) return;
            const from = form.sections.findIndex(
              (s) => s.section_key === dragging,
            );
            setDragging(null);
            moveSection(from, index);
          }}
          onMove={(delta) => moveSection(index, index + delta)}
          onRename={(title, description) =>
            periodId && courseId
              ? mutate(() =>
                  saveFormSection(
                    periodId,
                    courseId,
                    section.section_key,
                    title,
                    description,
                  ),
                )
              : Promise.resolve(false)
          }
          onSaveQuestion={(questionId, draft, displayOrder) =>
            saveQuestion(
              questionId,
              draft,
              section.title,
              section.section_order,
              displayOrder,
            )
          }
          onDeleteQuestion={(questionId) =>
            periodId && courseId
              ? mutate(() =>
                  deleteCourseFormQuestion(periodId, courseId, questionId),
                )
              : Promise.resolve(false)
          }
        />
      ))}

      {canEdit &&
        (addingSection ? (
          <SectionCard
            title="New section"
            description="A heading of your own, with its first question."
          >
            <NewSectionComposer
              busy={busy}
              existingSections={form.sections.length}
              onCancel={() => setAddingSection(false)}
              onSave={async (title, draft) => {
                const ok = await saveQuestion(
                  null,
                  draft,
                  title,
                  form.sections.length + 1,
                  1,
                );
                if (ok) setAddingSection(false);
              }}
            />
          </SectionCard>
        ) : (
          <Button variant="outline" onClick={() => setAddingSection(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add a section
          </Button>
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One section                                                         */
/* ------------------------------------------------------------------ */

function SectionBlock({
  section,
  index,
  total,
  canEdit,
  busy,
  dragging,
  dragOver,
  onDragStart,
  onDragEnd,
  onDragOverSection,
  onDropOn,
  onMove,
  onRename,
  onSaveQuestion,
  onDeleteQuestion,
}: {
  section: EditorSection;
  index: number;
  total: number;
  canEdit: boolean;
  busy: boolean;
  dragging: boolean;
  dragOver: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverSection: () => void;
  onDropOn: () => void;
  onMove: (delta: number) => void;
  onRename: (title: string, description: string | null) => Promise<boolean>;
  onSaveQuestion: (
    questionId: string | null,
    draft: Draft,
    displayOrder: number,
  ) => Promise<boolean>;
  onDeleteQuestion: (questionId: string) => Promise<boolean>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(section.title);
  const [description, setDescription] = useState(section.description ?? "");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  const nextOrder =
    Math.max(0, ...section.questions.map((q) => q.display_order)) + 1;

  return (
    <div
      /* The card is where a section can be dropped; the drag itself starts
         from the handle in the heading, so selecting text in a question or
         using its controls never begins one. */
      onDragOver={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOverSection();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn();
      }}
      className={[
        "rounded-2xl transition-shadow",
        dragging ? "opacity-50" : "",
        dragOver ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <SectionCard
        title={`${section.icon ? `${section.icon} ` : ""}${section.title}`}
        description={section.description ?? undefined}
        actions={
          canEdit && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                /* The drag source. A drag will not start at all unless
                   something is written to the transfer, which is why the
                   whole-card version did nothing. */
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", section.section_key);
                  e.dataTransfer.effectAllowed = "move";
                  onDragStart();
                }}
                onDragEnd={onDragEnd}
                className="hidden cursor-grab items-center rounded-md px-1 py-1 text-muted-foreground hover:bg-muted active:cursor-grabbing sm:inline-flex"
                title={`Drag to move ${section.title}`}
              >
                <GripVertical className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Drag to reorder {section.title}</span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || index === 0}
                onClick={() => onMove(-1)}
                aria-label={`Move ${section.title} up`}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || index === total - 1}
                onClick={() => onMove(1)}
                aria-label={`Move ${section.title} down`}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              {!renaming && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setTitle(section.title);
                    setDescription(section.description ?? "");
                    setRenaming(true);
                  }}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Edit section
                </Button>
              )}
            </div>
          )
        }
      >
        <div className="space-y-4">
          {renaming && (
            <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Section title
                </label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Description (optional)
                </label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Shown under the heading, e.g. Rate all statements below"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy || !title.trim()}
                  onClick={async () => {
                    const ok = await onRename(title, description.trim() || null);
                    if (ok) setRenaming(false);
                  }}
                >
                  {busy ? "Saving…" : "Save section"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setRenaming(false)}
                >
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {section.questions.map((q) => (
            <QuestionRow
              key={q.id}
              question={q}
              section={section}
              canEdit={canEdit}
              busy={busy}
              onSave={(d) => onSaveQuestion(q.id, d, q.display_order)}
              onDelete={() => onDeleteQuestion(q.id)}
            />
          ))}

          {canEdit &&
            (adding ? (
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <QuestionForm
                  draft={draft}
                  setDraft={setDraft}
                  busy={busy}
                  saveLabel="Add question"
                  onCancel={() => setAdding(false)}
                  onSave={async () => {
                    const ok = await onSaveQuestion(null, draft, nextOrder);
                    if (ok) {
                      setDraft(emptyDraft());
                      setAdding(false);
                    }
                  }}
                />
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setDraft(emptyDraft());
                  setAdding(true);
                }}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add a question here
              </Button>
            ))}
        </div>
      </SectionCard>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One question: preview, and its own editor                           */
/* ------------------------------------------------------------------ */

function QuestionRow({
  question,
  section,
  canEdit,
  busy,
  onSave,
  onDelete,
}: {
  question: EditorQuestion;
  section: EditorSection;
  canEdit: boolean;
  busy: boolean;
  onSave: (draft: Draft) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  /* Held here rather than by the page, so pressing Edit opens the editor on
     this question and nowhere else. */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(question));
  const [confirming, setConfirming] = useState(false);

  if (editing) {
    return (
      <div className="rounded-xl border border-primary/40 bg-muted/30 p-3">
        <QuestionForm
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          saveLabel="Save question"
          onCancel={() => setEditing(false)}
          onSave={async () => {
            const ok = await onSave(draft);
            if (ok) setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border p-3">
      {/* The control the student will answer, shown as they will see it. */}
      <QuestionField
        question={{
          id: question.id,
          question_text: question.question_text,
          question_type: question.question_type,
          category: null,
          display_order: question.display_order,
          is_required: question.is_required,
          options: question.options,
          placeholder: question.placeholder,
          target_type: question.target_type,
          section_key: section.section_key,
          section_title: section.title,
          section_order: section.section_order,
          depends_on_question_id: null,
          depends_on_values: null,
        }}
        answer={undefined}
        disabled
        maxTextLength={1000}
        onChange={() => {}}
      />

      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setDraft(draftFrom(question));
              setEditing(true);
            }}
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit
          </Button>
          {confirming ? (
            <>
              <span className="text-xs text-muted-foreground">
                Remove this question?
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Keep
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  const ok = await onDelete();
                  if (ok) setConfirming(false);
                }}
              >
                Remove
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Remove
            </Button>
          )}
          {question.is_required && (
            <StatusBadge tone="neutral">Required</StatusBadge>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The fields of a question                                            */
/* ------------------------------------------------------------------ */

function QuestionForm({
  draft,
  setDraft,
  busy,
  saveLabel,
  onSave,
  onCancel,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  busy: boolean;
  saveLabel: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Question
        </label>
        <Input
          value={draft.text}
          autoFocus
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          placeholder="e.g. The laboratory sessions were well organised"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Answer type
          </label>
          <select
            value={draft.type}
            onChange={(e) =>
              setDraft({ ...draft, type: e.target.value as FeedbackQuestionType })
            }
            className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {(draft.type === "short_text" || draft.type === "long_text") && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Grey prompt inside the box (optional)
            </label>
            <Input
              value={draft.placeholder}
              onChange={(e) =>
                setDraft({ ...draft, placeholder: e.target.value })
              }
              placeholder="e.g. Anything that would have helped"
            />
          </div>
        )}
      </div>

      {needsOptions(draft.type) && (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Options, one per line
          </label>
          <textarea
            value={draft.options}
            onChange={(e) => setDraft({ ...draft, options: e.target.value })}
            rows={4}
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground"
            placeholder={"Weekly\nFortnightly\nNever"}
          />
        </div>
      )}

      <label className="flex cursor-pointer items-start gap-2.5">
        <Checkbox
          className="mt-0.5"
          checked={draft.required}
          onCheckedChange={(v) => setDraft({ ...draft, required: v === true })}
        />
        <span>
          <span className="text-sm text-foreground">An answer is required</span>
          <span className="block text-xs text-muted-foreground">
            A student cannot submit the form without answering it.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap gap-2 border-t border-border/70 pt-3">
        <Button disabled={busy} onClick={onSave}>
          {busy ? "Saving…" : saveLabel}
        </Button>
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          <X className="mr-1.5 h-4 w-4" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* A brand-new section starts with its heading and its first question. */
function NewSectionComposer({
  busy,
  existingSections,
  onSave,
  onCancel,
}: {
  busy: boolean;
  existingSections: number;
  onSave: (title: string, draft: Draft) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Section title
        </label>
        <Input
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Practical work"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          It will sit after the {existingSections} section
          {existingSections === 1 ? "" : "s"} already on this form. You can move
          it afterwards.
        </p>
      </div>
      <QuestionForm
        draft={draft}
        setDraft={setDraft}
        busy={busy}
        saveLabel="Add section"
        onCancel={onCancel}
        onSave={() => onSave(title.trim() || "New section", draft)}
      />
    </div>
  );
}
