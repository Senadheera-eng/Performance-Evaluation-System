import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Eye,
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
import type { FeedbackOption, FeedbackQuestionType } from "../../../lib/feedbackService";
import {
  deleteCourseFormQuestion,
  getCourseFormEditor,
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

interface Editing {
  questionId: string | null;
  text: string;
  type: FeedbackQuestionType;
  options: string;
  placeholder: string;
  required: boolean;
  sectionTitle: string;
}

const blank = (sectionTitle: string): Editing => ({
  questionId: null,
  text: "",
  type: "rating",
  options: "",
  placeholder: "",
  required: false,
  sectionTitle,
});

/**
 * The feedback form for one course, as its lecturer shapes it.
 *
 * Laid out as the student will meet it, top to bottom, with every question
 * shown through the very control the student will answer — the same
 * QuestionField the form itself renders. A lecturer should not have to
 * imagine what they are building.
 *
 * Two kinds of section appear. The department's are fixed: they belong to
 * every course in the round, so one lecturer editing them would rewrite
 * everyone's form. The course's own can be added to, edited and removed,
 * and only while the round is a draft — once the department opens it every
 * student has to be answering the same questions. The database enforces
 * both, and refuses a course the person does not teach.
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
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /* Which section's title and description are being rewritten. */
  const [editingSection, setEditingSection] = useState<{
    key: string;
    title: string;
    description: string;
    shared: boolean;
  } | null>(null);

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

  /* The sections this course owns, for the "add to an existing section"
     choice and to place a new one after them. */
  const mySections = useMemo(
    () => (form?.sections ?? []).filter((s) => s.mine),
    [form],
  );

  const save = async () => {
    if (!form || !editing || !periodId || !courseId) return;
    if (!editing.text.trim()) {
      setError("Give the question some text.");
      return;
    }
    const options: FeedbackOption[] | null = needsOptions(editing.type)
      ? editing.options
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((label) => ({
            label,
            value: label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
          }))
      : null;
    if (needsOptions(editing.type) && (options?.length ?? 0) === 0) {
      setError("A choice question needs at least one option.");
      return;
    }

    const sectionTitle = editing.sectionTitle.trim() || "Course-Specific Questions";
    const existing = mySections.find((s) => s.title === sectionTitle);
    /* A new section goes after the department's (which sit at 9 and below)
       and after the ones this course already has. */
    const sectionOrder = existing
      ? existing.section_order
      : 9 + mySections.length;
    const displayOrder = editing.questionId
      ? (existing?.questions.find((q) => q.id === editing.questionId)
          ?.display_order ?? 1)
      : (existing?.questions.length ?? 0) + 1;

    setBusy(true);
    setError(null);
    const result = await saveCourseFormQuestion(periodId, courseId, {
      questionId: editing.questionId,
      questionText: editing.text,
      questionType: editing.type,
      options,
      placeholder: editing.placeholder.trim() || null,
      isRequired: editing.required,
      sectionTitle,
      sectionOrder,
      displayOrder,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(null);
    await load();
    setNotice(result.data);
  };

  const saveSection = async () => {
    if (!editingSection || !periodId || !courseId) return;
    if (!editingSection.title.trim()) {
      setError("Give the section a title.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await saveFormSection(
      periodId,
      courseId,
      editingSection.key,
      editingSection.title,
      editingSection.description.trim() || null,
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditingSection(null);
    await load();
    setNotice(result.data);
  };

  const remove = async (questionId: string) => {
    if (!periodId || !courseId) return;
    setBusy(true);
    setError(null);
    const result = await deleteCourseFormQuestion(periodId, courseId, questionId);
    setBusy(false);
    setConfirmDelete(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await load();
    setNotice(result.data);
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
          form.can_edit ? (
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
        {!form.can_edit
          ? "This is the form as your students see it. The round is no longer a draft, so it cannot be changed."
          : form.manages_round
            ? "This is the form as your students will see it. You can change any of it while the round is a draft — the department's sections are asked of every course in this round, so those changes reach all of them."
            : "This is the form as your students will see it. Your department's sections are asked of every course in this round and are theirs to change; what you add appears on this course only. Everything stops being editable when the round opens."}
      </p>

      {form.sections.length === 0 && (
        <SectionCard title="Nothing on this form yet">
          <p className="text-sm text-muted-foreground">
            Your department has not added its questions yet. Anything you add
            here will sit after them.
          </p>
        </SectionCard>
      )}

      {form.sections.map((section) => (
        <FormSection
          key={section.section_key}
          section={section}
          busy={busy}
          confirmDelete={confirmDelete}
          editingSection={
            editingSection?.key === section.section_key ? editingSection : null
          }
          onEditSection={() =>
            setEditingSection({
              key: section.section_key,
              title: section.title,
              description: section.description ?? "",
              shared: !section.mine,
            })
          }
          onSectionChange={(patch) =>
            setEditingSection((prev) => (prev ? { ...prev, ...patch } : prev))
          }
          onSaveSection={saveSection}
          onCancelSection={() => setEditingSection(null)}
          onEdit={(q) =>
            setEditing({
              questionId: q.id,
              text: q.question_text,
              type: q.question_type,
              options: (q.options ?? []).map((o) => o.label).join("\n"),
              placeholder: q.placeholder ?? "",
              required: q.is_required,
              sectionTitle: section.title,
            })
          }
          onAskDelete={setConfirmDelete}
          onDelete={remove}
          onAdd={() => setEditing(blank(section.title))}
        />
      ))}

      {form.can_edit && !editing && (
        <Button variant="outline" onClick={() => setEditing(blank(""))}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add a section
        </Button>
      )}

      {editing && (
        <QuestionEditor
          editing={editing}
          setEditing={setEditing}
          sections={mySections.map((s) => s.title)}
          busy={busy}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function FormSection({
  section,
  busy,
  confirmDelete,
  editingSection,
  onEditSection,
  onSectionChange,
  onSaveSection,
  onCancelSection,
  onEdit,
  onAskDelete,
  onDelete,
  onAdd,
}: {
  section: EditorSection;
  busy: boolean;
  confirmDelete: string | null;
  editingSection: { title: string; description: string; shared: boolean } | null;
  onEditSection: () => void;
  onSectionChange: (patch: { title?: string; description?: string }) => void;
  onSaveSection: () => void;
  onCancelSection: () => void;
  onEdit: (q: EditorQuestion) => void;
  onAskDelete: (id: string | null) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <SectionCard
      title={`${section.icon ? `${section.icon} ` : ""}${section.title}`}
      description={section.description ?? undefined}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {section.mine ? (
            <StatusBadge tone="brand">Yours</StatusBadge>
          ) : (
            <StatusBadge tone={section.can_edit ? "info" : "neutral"} icon={section.can_edit ? undefined : Lock}>
              {section.can_edit ? "Every course in this round" : "Your department's"}
            </StatusBadge>
          )}
          {section.can_edit && !editingSection && (
            <Button size="sm" variant="outline" onClick={onEditSection}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit section
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {editingSection && (
          <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Section title
              </label>
              <Input
                value={editingSection.title}
                onChange={(e) => onSectionChange({ title: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Description (optional)
              </label>
              <Input
                value={editingSection.description}
                onChange={(e) => onSectionChange({ description: e.target.value })}
                placeholder="Shown under the heading, e.g. Rate all statements below"
              />
            </div>
            {editingSection.shared && (
              /* The department's sections are one set of questions asked of
                 every course in the round, so this is not a local change. */
              <p className="text-xs text-warning-fg">
                This section is asked of every course in this round. Renaming it
                changes it for all of them.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={onSaveSection}>
                {busy ? "Saving…" : "Save section"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onCancelSection}
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
          </div>
        )}
        {section.questions.map((q) => (
          <div
            key={q.id}
            className={`rounded-xl border p-3 ${
              q.mine ? "border-border" : "border-border/60 bg-muted/20"
            }`}
          >
            {/* The control the student will answer, shown as they will see
                it and not answerable here. */}
            <QuestionField
              question={{
                id: q.id,
                question_text: q.question_text,
                question_type: q.question_type,
                category: null,
                display_order: q.display_order,
                is_required: q.is_required,
                options: q.options,
                placeholder: q.placeholder,
                target_type: q.target_type,
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

            {q.can_edit && (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                <Button size="sm" variant="outline" onClick={() => onEdit(q)}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Edit
                </Button>
                {confirmDelete === q.id ? (
                  <>
                    <span className="text-xs text-muted-foreground">
                      Remove this question?
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAskDelete(null)}
                    >
                      Keep
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => onDelete(q.id)}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => onAskDelete(q.id)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Remove
                  </Button>
                )}
                {q.is_required && (
                  <StatusBadge tone="neutral">Required</StatusBadge>
                )}
              </div>
            )}
          </div>
        ))}

        {section.can_edit && section.mine && (
          <Button variant="outline" size="sm" onClick={onAdd}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add a question to {section.title}
          </Button>
        )}
      </div>
    </SectionCard>
  );
}

function QuestionEditor({
  editing,
  setEditing,
  sections,
  busy,
  onSave,
  onCancel,
}: {
  editing: Editing;
  setEditing: (e: Editing) => void;
  sections: string[];
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <SectionCard
      title={editing.questionId ? "Edit question" : "New question"}
      description="Your students see this on this course only."
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Section
          </label>
          <Input
            value={editing.sectionTitle}
            onChange={(e) =>
              setEditing({ ...editing, sectionTitle: e.target.value })
            }
            list="existing-sections"
            placeholder="e.g. Practical work"
          />
          <datalist id="existing-sections">
            {sections.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <p className="mt-1 text-xs text-muted-foreground">
            A new name starts a new section; an existing one adds to it.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Question
          </label>
          <Input
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            placeholder="e.g. The laboratory sessions were well organised"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Answer type
            </label>
            <select
              value={editing.type}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  type: e.target.value as FeedbackQuestionType,
                })
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

          {(editing.type === "short_text" || editing.type === "long_text") && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Grey prompt inside the box (optional)
              </label>
              <Input
                value={editing.placeholder}
                onChange={(e) =>
                  setEditing({ ...editing, placeholder: e.target.value })
                }
                placeholder="e.g. Anything that would have helped"
              />
            </div>
          )}
        </div>

        {needsOptions(editing.type) && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Options, one per line
            </label>
            <textarea
              value={editing.options}
              onChange={(e) =>
                setEditing({ ...editing, options: e.target.value })
              }
              rows={4}
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground"
              placeholder={"Weekly\nFortnightly\nNever"}
            />
          </div>
        )}

        <label className="flex cursor-pointer items-start gap-2.5">
          <Checkbox
            className="mt-0.5"
            checked={editing.required}
            onCheckedChange={(v) =>
              setEditing({ ...editing, required: v === true })
            }
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
            {busy ? "Saving…" : editing.questionId ? "Save changes" : "Add question"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            <X className="mr-1.5 h-4 w-4" />
            Cancel
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
