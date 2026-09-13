import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Megaphone,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Save,
  Send,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SegmentedTabs,
  SkeletonRows,
  StatusBadge,
} from "../components/common";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { describeBatch } from "../../lib/batch";
import { useSettings } from "../../lib/settings";
import {
  BODY_MAX,
  deleteNotice,
  fetchManageableNotices,
  fetchNotice,
  fetchPublishingScope,
  formatBytes,
  removeNoticeFile,
  saveNotice,
  setNoticeStatus,
  uploadNoticeFile,
  type ManageableNotice,
  type NoticeAttachment,
  type NoticeDraft,
  type PublishingScope,
} from "../../lib/notices";

interface OfferingOption {
  offering_id: string;
  course_code: string;
  course_title: string;
  batch_year: number;
  academic_year: string;
  semester: number;
}

/**
 * Publishing, for everyone who may publish.
 *
 * One page rather than three, because the difference between a super admin, a
 * department admin, a head and a lecturer is entirely a question of scope —
 * and scope is already decided by the database. The form asks
 * get_my_notice_publishing_scope what it may offer and renders that. Nothing
 * here reimplements the hierarchy, so nothing here can disagree with it.
 *
 * A lecturer therefore sees a course picker and no department field; a
 * department admin sees their own department fixed and cannot type another;
 * a super admin sees the faculty-wide option nobody else gets.
 */
export default function ManageNotices() {
  const { student, staff } = useAuth();
  const settings = useSettings();

  const [scope, setScope] = useState<PublishingScope | null>(null);
  const [notices, setNotices] = useState<ManageableNotice[]>([]);
  const [offerings, setOfferings] = useState<OfferingOption[]>([]);
  const [tab, setTab] = useState<"published" | "draft" | "archived">("published");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ManageableNotice | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, list] = await Promise.all([
      fetchPublishingScope(),
      fetchManageableNotices(),
    ]);
    setScope(s);
    setNotices(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* Only the offerings this person may actually publish against. A lecturer
     gets their own teaching; a head or admin gets the department's. */
  useEffect(() => {
    if (!scope?.can_publish) return;
    (async () => {
      const rpc =
        scope.kind === "lecturer"
          ? "get_my_teaching"
          : "get_department_teaching";
      const { data, error } = await supabase.rpc(
        rpc,
        scope.kind === "lecturer"
          ? {}
          : { p_batch_year: null, p_semester: null },
      );
      if (error) {
        console.error("[ManageNotices] offerings failed", error);
        return;
      }
      setOfferings((data ?? []) as OfferingOption[]);
    })();
  }, [scope?.kind, scope?.can_publish]);

  const visible = useMemo(
    () => notices.filter((n) => n.status === tab),
    [notices, tab],
  );

  const counts = useMemo(
    () => ({
      published: notices.filter((n) => n.status === "published").length,
      draft: notices.filter((n) => n.status === "draft").length,
      archived: notices.filter((n) => n.status === "archived").length,
    }),
    [notices],
  );

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader title="Notices" />
        <SectionCard title="Loading">
          <SkeletonRows count={5} />
        </SectionCard>
      </div>
    );
  }

  if (!scope?.can_publish) {
    return (
      <div className="space-y-5">
        <PageHeader title="Notices" />
        <EmptyState
          icon={Megaphone}
          title="You cannot publish notices"
          description="Notices are published by lecturers for their own courses, and by heads of department, department admins and the Super Admin for wider audiences."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notices"
        description={
          scope.kind === "lecturer"
            ? "Publish schedules and announcements to the students on your courses."
            : scope.kind === "super_admin"
              ? "Publish across the faculty, or to a single department, batch or course."
              : `Publish to ${scope.department} students.`
        }
        actions={
          editing === null ? (
            <Button onClick={() => setEditing("new")}>
              <Plus className="mr-1.5 h-4 w-4" />
              New notice
            </Button>
          ) : undefined
        }
      />

      {notice && (
        <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2.5 text-sm text-success-fg">
          {notice}
        </div>
      )}

      {editing !== null && (
        <NoticeForm
          scope={scope}
          offerings={offerings}
          noticeId={editing === "new" ? null : editing}
          author={{
            id: student?.id ?? "",
            name: student?.name ?? "Unknown",
            role: describeRole(scope.kind, staff?.hodDepartment ?? null),
          }}
          totalSemesters={settings.totalSemesters}
          onDone={(message) => {
            setEditing(null);
            setNotice(message);
            load();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      <SegmentedTabs
        aria-label="Notice status"
        value={tab}
        onChange={(v) => setTab(v as typeof tab)}
        layoutId="manage-notice-tabs"
        tabs={[
          { value: "published", label: "Published", count: counts.published },
          { value: "draft", label: "Drafts", count: counts.draft },
          { value: "archived", label: "Archived", count: counts.archived },
        ]}
      />

      <SectionCard title={`${tab[0].toUpperCase()}${tab.slice(1)}`} flush>
        {visible.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Megaphone}
              title={`No ${tab} notices`}
              description={
                tab === "published"
                  ? "Anything you publish appears here, and on your students' notice board."
                  : tab === "draft"
                    ? "A draft is visible only to you until you publish it."
                    : "Archived notices stay readable to students who could already see them."
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {visible.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-center gap-2 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {n.category_label}
                    </span>
                    {n.is_pinned && (
                      <StatusBadge tone="danger" icon={Pin}>
                        Important
                      </StatusBadge>
                    )}
                    {n.is_expired && (
                      <StatusBadge tone="neutral">Expired</StatusBadge>
                    )}
                  </div>
                  <p className="font-medium text-foreground">{n.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      n.course_code,
                      n.department ?? "All departments",
                      n.batch_year ? describeBatch(n.batch_year) : null,
                      n.semester ? `Semester ${n.semester}` : null,
                      n.attachment_count > 0
                        ? `${n.attachment_count} file${n.attachment_count === 1 ? "" : "s"}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(n.id)}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Edit
                  </Button>
                  {n.status === "draft" && (
                    <Button
                      size="sm"
                      onClick={async () => {
                        await setNoticeStatus(n.id, "published");
                        setNotice(`"${n.title}" published.`);
                        load();
                      }}
                    >
                      <Send className="mr-1 h-3.5 w-3.5" />
                      Publish
                    </Button>
                  )}
                  {n.status === "published" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await setNoticeStatus(n.id, "archived");
                        setNotice(`"${n.title}" archived.`);
                        load();
                      }}
                    >
                      <Archive className="mr-1 h-3.5 w-3.5" />
                      Archive
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${n.title}`}
                    onClick={() => setConfirmDelete(n)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this notice?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirmDelete?.title}" and its documents are removed for good.
              If you only want it off the board, archive it instead — students
              who could see it keep their access to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmDelete) return;
                await deleteNotice(confirmDelete.id);
                setNotice(`"${confirmDelete.title}" deleted.`);
                setConfirmDelete(null);
                load();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function describeRole(kind: string, hodDepartment: string | null): string {
  if (kind === "super_admin") return "Super Admin";
  if (kind === "dept_admin") return "Department Admin";
  if (kind === "hod") return `Head of ${hodDepartment ?? "Department"}`;
  return "Lecturer";
}

/* ------------------------------------------------------------------ */

function NoticeForm({
  scope,
  offerings,
  noticeId,
  author,
  totalSemesters,
  onDone,
  onCancel,
}: {
  scope: PublishingScope;
  offerings: OfferingOption[];
  noticeId: string | null;
  author: { id: string; name: string; role: string };
  totalSemesters: number;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const settings = useSettings();
  const forLecturer = scope.must_target_offering === true;

  const categories = forLecturer ? scope.offering_categories : scope.categories;

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(categories[0]?.slug ?? "");
  const [body, setBody] = useState("");
  const [department, setDepartment] = useState<string>(
    scope.can_target_faculty ? "" : (scope.department ?? ""),
  );
  const [batchYear, setBatchYear] = useState<string>("");
  const [semester, setSemester] = useState<string>("");
  const [academicYear, setAcademicYear] = useState<string>("");
  const [offeringId, setOfferingId] = useState<string>("");
  const [isPinned, setIsPinned] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");

  const [existingFiles, setExistingFiles] = useState<NoticeAttachment[]>([]);
  const [queued, setQueued] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /* Editing loads what is there; creating starts from the scope's defaults. */
  useEffect(() => {
    if (!noticeId) return;
    fetchNotice(noticeId).then((n) => {
      if (!n) return;
      setTitle(n.title);
      setCategory(n.category);
      setBody(n.body ?? "");
      setDepartment(n.department ?? "");
      setBatchYear(n.batch_year?.toString() ?? "");
      setSemester(n.semester?.toString() ?? "");
      setAcademicYear(n.academic_year ?? "");
      setOfferingId(n.offering_id ?? "");
      setIsPinned(n.is_pinned);
      setExpiresAt(n.expires_at ? n.expires_at.slice(0, 10) : "");
      setExistingFiles(n.attachments);
    });
  }, [noticeId]);

  const batchOptions = useMemo(
    () => [...new Set(offerings.map((o) => o.batch_year))].sort((a, b) => b - a),
    [offerings],
  );

  const submit = async (publish: boolean) => {
    setError(null);
    if (title.trim().length < 3) {
      setError("Give the notice a title of at least three characters.");
      return;
    }
    if (!category) {
      setError("Choose a category.");
      return;
    }
    if (forLecturer && !offeringId) {
      setError("Choose which of your courses this is for.");
      return;
    }
    setSaving(true);

    const draft: NoticeDraft = {
      title: title.trim(),
      category,
      body: body.trim() || null,
      // A course-scoped notice takes its department from the offering.
      department: offeringId ? null : department || null,
      batch_year: batchYear ? Number(batchYear) : null,
      semester: semester ? Number(semester) : null,
      academic_year: academicYear || null,
      offering_id: offeringId || null,
      is_pinned: isPinned,
      expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
    };

    const saved = await saveNotice(draft, publish, author, noticeId ?? undefined);
    if (!saved.ok) {
      setSaving(false);
      setError(saved.error);
      return;
    }

    /* Files go up after the notice exists, because the storage policy keys
       on the notice id — there is nowhere to put them before that. */
    const failures: string[] = [];
    for (const [i, f] of queued.entries()) {
      const up = await uploadNoticeFile(saved.id, f, existingFiles.length + i);
      if (!up.ok) failures.push(up.error);
    }
    setSaving(false);

    if (failures.length > 0) {
      setError(
        `The notice was saved, but ${failures.length} file(s) did not attach. ${failures[0]}`,
      );
      return;
    }
    onDone(
      publish
        ? `"${draft.title}" published${queued.length ? ` with ${queued.length} document(s)` : ""}.`
        : `"${draft.title}" saved as a draft.`,
    );
  };

  return (
    <SectionCard
      title={noticeId ? "Edit notice" : "New notice"}
      description={
        forLecturer
          ? "Goes to the students enrolled in the course you choose."
          : scope.can_target_faculty
            ? "Leave department empty to reach the whole faculty."
            : `Goes to ${scope.department} students matching the scope you set.`
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Semester 7 Examination Timetable"
              maxLength={200}
            />
          </Field>

          <Field label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-9 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground"
            >
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* The message, not a description of one. It was labelled
            "Description" and sized like a summary field, which read as
            metadata about the attachment — so notices went out with a title,
            a file and nothing said. A notice with no document at all is a
            perfectly good notice, and this is where it lives. */}
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Message (optional)
            </span>
            {body.length > 0 && (
              <span
                className={`text-xs tabular-nums ${
                  body.length > BODY_MAX - 500
                    ? "text-warning-fg"
                    : "text-muted-foreground"
                }`}
              >
                {body.length.toLocaleString()} / {BODY_MAX.toLocaleString()}
              </span>
            )}
          </div>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            maxLength={BODY_MAX}
            placeholder={
              "Write the notice here.\n\n" +
              "Line breaks are kept, so you can list dates or steps. A document is optional — a message on its own is a complete notice."
            }
          />
          <p className="text-xs text-muted-foreground">
            Shown in full on the notice, and as the preview line on the board
            and in the notification students receive.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {forLecturer ? (
            <div className="sm:col-span-2">
              <Field label="Course">
                <select
                  value={offeringId}
                  onChange={(e) => setOfferingId(e.target.value)}
                  className="h-9 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground"
                >
                  <option value="">Choose a course...</option>
                  {offerings.map((o) => (
                    <option key={o.offering_id} value={o.offering_id}>
                      {o.course_code} — {o.course_title} ·{" "}
                      {describeBatch(o.batch_year)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : (
            <>
              <Field label="Department">
                {scope.can_target_faculty ? (
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="h-9 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground"
                  >
                    <option value="">All departments (faculty-wide)</option>
                    {settings.studentDepartments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex h-9 items-center rounded-xl border border-border bg-muted/40 px-3 text-sm text-foreground">
                    {scope.department}
                  </div>
                )}
              </Field>

              <Field label="Course (optional)">
                <select
                  value={offeringId}
                  onChange={(e) => setOfferingId(e.target.value)}
                  className="h-9 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground"
                >
                  <option value="">Not course-specific</option>
                  {offerings.map((o) => (
                    <option key={o.offering_id} value={o.offering_id}>
                      {o.course_code} · {describeBatch(o.batch_year)}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}

          <Field label="Batch (optional)">
            <select
              value={batchYear}
              onChange={(e) => setBatchYear(e.target.value)}
              className="h-9 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground"
            >
              <option value="">All batches</option>
              {batchOptions.map((b) => (
                <option key={b} value={b}>
                  {describeBatch(b)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Semester (optional)">
            <select
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
              className="h-9 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground"
            >
              <option value="">Any semester</option>
              {Array.from({ length: totalSemesters }, (_, i) => i + 1).map(
                (s) => (
                  <option key={s} value={s}>
                    Semester {s}
                  </option>
                ),
              )}
            </select>
          </Field>

          <Field label="Academic year (optional)">
            <Input
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              placeholder="2024/2025"
            />
          </Field>

          <Field label="Expires (optional)">
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={isPinned}
            onChange={(e) => setIsPinned(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <Pin className="h-3.5 w-3.5 text-muted-foreground" />
          Mark as important — pins it to the top of the board
        </label>

        {/* Documents */}
        <div className="rounded-xl border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">
              Documents
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Add file
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                /* Read the files out before clearing the input, and hand the
                   array to setState rather than reading e.target inside the
                   updater: React runs that later, by which point value = ""
                   has already emptied the FileList and nothing was added. */
                const picked = Array.from(e.target.files ?? []);
                e.target.value = "";
                setQueued((prev) => [...prev, ...picked]);
              }}
            />
          </div>

          {existingFiles.length === 0 && queued.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              PDFs, images, Office documents or plain text, up to 20 MB each.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {existingFiles.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 text-xs text-foreground"
                >
                  <Paperclip className="h-3 w-3 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{a.file_name}</span>
                  <span className="text-muted-foreground">
                    {formatBytes(a.size_bytes)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.file_name}`}
                    onClick={async () => {
                      await removeNoticeFile(a.id, a.path);
                      setExistingFiles((prev) =>
                        prev.filter((f) => f.id !== a.id),
                      );
                    }}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
              {queued.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-2 text-xs text-foreground"
                >
                  <Paperclip className="h-3 w-3 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="text-muted-foreground">
                    {formatBytes(f.size)}
                  </span>
                  <StatusBadge tone="info">new</StatusBadge>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() =>
                      setQueued((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <ErrorState message={error} size="inline" />}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="flex-1" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            disabled={saving}
            onClick={() => submit(false)}
          >
            <Save className="mr-1.5 h-4 w-4" />
            Save draft
          </Button>
          <Button className="flex-1" disabled={saving} onClick={() => submit(true)}>
            <Send className="mr-1.5 h-4 w-4" />
            {saving ? "Publishing..." : "Publish"}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
