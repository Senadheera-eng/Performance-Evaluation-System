import { supabase } from "./supabase";

/**
 * The academic notice board's data access.
 *
 * Every read goes through a database function that applies the same
 * visibility rule the row policy applies, so nothing here filters for
 * security — filtering here would only decide what a student is shown, and
 * what they are shown is not the same thing as what they can reach.
 *
 * Attachments live in a private bucket. There is no public URL anywhere in
 * this file: a link is signed on demand, and only after the database has
 * agreed the reader may see the notice it belongs to.
 */

export const NOTICE_BUCKET = "notice-attachments";
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

/** Matches the length check on notices.body. Kept here so the counter in
 *  the form and the constraint in the database cannot disagree. */
export const BODY_MAX = 5000;

/** Kept in step with the bucket's allowed_mime_types, which is the real gate. */
export const ALLOWED_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
];

export interface NoticeCategory {
  slug: string;
  label: string;
  icon: string;
}

export interface NoticeSummary {
  id: string;
  title: string;
  category: string;
  category_label: string;
  category_icon: string;
  body: string | null;
  department: string | null;
  batch_year: number | null;
  semester: number | null;
  academic_year: string | null;
  offering_id: string | null;
  course_code: string | null;
  course_title: string | null;
  status: string;
  is_pinned: boolean;
  published_at: string | null;
  expires_at: string | null;
  is_expired: boolean;
  created_by_name: string;
  created_by_role: string;
  attachment_count: number;
  relevance: number;
  total_count: number;
}

export interface NoticeAttachment {
  id: string;
  path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
}

export interface NoticeDetail
  extends Omit<NoticeSummary, "attachment_count" | "relevance" | "total_count"> {
  can_edit: boolean;
  attachments: NoticeAttachment[];
}

export interface NoticeFilters {
  scope?: "all" | "for_me";
  category?: string | null;
  department?: string | null;
  batchYear?: number | null;
  semester?: number | null;
  academicYear?: string | null;
  pinnedOnly?: boolean;
  includeExpired?: boolean;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export async function fetchNotices(
  f: NoticeFilters = {},
): Promise<{ items: NoticeSummary[]; total: number }> {
  const { data, error } = await supabase.rpc("get_my_notices", {
    p_scope: f.scope ?? "all",
    p_category: f.category ?? null,
    p_department: f.department ?? null,
    p_batch_year: f.batchYear ?? null,
    p_semester: f.semester ?? null,
    p_academic_year: f.academicYear ?? null,
    p_pinned_only: f.pinnedOnly ?? false,
    p_include_expired: f.includeExpired ?? false,
    p_search: f.search?.trim() || null,
    p_limit: f.limit ?? 20,
    p_offset: f.offset ?? 0,
  });
  if (error) {
    console.error("[notices] list failed", error);
    return { items: [], total: 0 };
  }
  const items = (data ?? []) as NoticeSummary[];
  /* total_count rides on every row because it comes from a window function.
     An empty page legitimately has no rows and therefore no total. */
  return { items, total: items[0]?.total_count ?? 0 };
}

export async function fetchNotice(id: string): Promise<NoticeDetail | null> {
  const { data, error } = await supabase.rpc("get_notice", { p_id: id });
  if (error) {
    console.error("[notices] detail failed", error);
    return null;
  }
  const row = (data ?? [])[0] as NoticeDetail | undefined;
  return row ?? null;
}

/**
 * Opening a notice is what clears its badge.
 *
 * The sidebar count is unread notice notifications, so reading the notice
 * has to mark them read or the number would sit there for ever. Failure is
 * swallowed on purpose: a badge that stays up one refresh longer is not
 * worth an error in front of someone trying to read a timetable.
 */
export async function markNoticeRead(noticeId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_notice_read", {
    p_notice_id: noticeId,
  });
  if (error) console.error("[notices] mark read failed", error);
}

/**
 * How many unread notices sit in each category.
 *
 * The same unread notifications the sidebar badge counts, grouped by the
 * category of the notice they point at — so the chips always add up to the
 * number beside Notices, rather than being a second tally that could drift.
 */
export async function fetchUnreadNoticeCounts(): Promise<
  Record<string, number>
> {
  const { data, error } = await supabase.rpc("get_my_unread_notice_counts");
  if (error) {
    console.error("[notices] unread counts failed", error);
    return {};
  }
  const out: Record<string, number> = {};
  for (const row of (data ?? []) as { category: string; unread: number }[]) {
    out[row.category] = row.unread;
  }
  return out;
}

export async function fetchCategories(): Promise<NoticeCategory[]> {
  const { data, error } = await supabase
    .from("notice_categories")
    .select("slug, label, icon")
    .eq("is_active", true)
    .order("sort_order");
  if (error) {
    console.error("[notices] categories failed", error);
    return [];
  }
  return (data ?? []) as NoticeCategory[];
}

/* ------------------------------------------------------------------ */
/* Publishing                                                          */
/* ------------------------------------------------------------------ */

export interface PublishingScope {
  can_publish: boolean;
  kind: "super_admin" | "dept_admin" | "hod" | "lecturer" | "none";
  department?: string | null;
  can_target_faculty?: boolean;
  must_target_offering?: boolean;
  categories: NoticeCategory[];
  offering_categories: NoticeCategory[];
}

/** What this person may file, answered by the database rather than guessed. */
export async function fetchPublishingScope(): Promise<PublishingScope> {
  const { data, error } = await supabase.rpc(
    "get_my_notice_publishing_scope",
  );
  if (error) {
    console.error("[notices] scope failed", error);
    return { can_publish: false, kind: "none", categories: [], offering_categories: [] };
  }
  return data as PublishingScope;
}

export interface ManageableNotice {
  id: string;
  title: string;
  category: string;
  category_label: string;
  department: string | null;
  batch_year: number | null;
  semester: number | null;
  academic_year: string | null;
  course_code: string | null;
  status: string;
  is_pinned: boolean;
  published_at: string | null;
  expires_at: string | null;
  is_expired: boolean;
  created_by_name: string;
  attachment_count: number;
  total_count: number;
}

export async function fetchManageableNotices(
  status?: string | null,
  search?: string | null,
): Promise<ManageableNotice[]> {
  const { data, error } = await supabase.rpc("get_manageable_notices", {
    p_status: status ?? null,
    p_search: search?.trim() || null,
    p_limit: 100,
    p_offset: 0,
  });
  if (error) {
    console.error("[notices] manageable failed", error);
    return [];
  }
  return (data ?? []) as ManageableNotice[];
}

export interface NoticeDraft {
  title: string;
  category: string;
  body: string | null;
  department: string | null;
  batch_year: number | null;
  semester: number | null;
  academic_year: string | null;
  offering_id: string | null;
  is_pinned: boolean;
  expires_at: string | null;
}

type SaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Create or update a notice.
 *
 * Written straight to the table rather than through an RPC, because the row
 * policy already is the rule: an insert outside the caller's scope is refused
 * by the database whatever this function sends.
 */
export async function saveNotice(
  draft: NoticeDraft,
  publish: boolean,
  author: { id: string; name: string; role: string },
  existingId?: string,
): Promise<SaveResult> {
  const payload = {
    ...draft,
    status: publish ? "published" : "draft",
    /* Stamped when it first goes live and left alone afterwards, so editing
       a typo does not move a notice back to the top of everyone's feed. */
    ...(publish ? { published_at: new Date().toISOString() } : {}),
  };

  if (existingId) {
    const { data: current } = await supabase
      .from("notices")
      .select("published_at, status")
      .eq("id", existingId)
      .maybeSingle();

    const keepDate =
      current?.status === "published" && current?.published_at
        ? { published_at: current.published_at }
        : {};

    const { error } = await supabase
      .from("notices")
      .update({ ...payload, ...keepDate })
      .eq("id", existingId);
    if (error) return { ok: false, error: friendly(error.message) };
    return { ok: true, id: existingId };
  }

  const { data, error } = await supabase
    .from("notices")
    .insert({
      ...payload,
      created_by: author.id,
      created_by_name: author.name,
      created_by_role: author.role,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: friendly(error?.message ?? "Could not save.") };
  }
  return { ok: true, id: data.id };
}

export async function setNoticeStatus(
  id: string,
  status: "draft" | "published" | "archived",
): Promise<boolean> {
  const patch: Record<string, unknown> =
    status === "published"
      ? { status, published_at: new Date().toISOString() }
      : { status };
  const { error } = await supabase.from("notices").update(patch).eq("id", id);
  if (error) {
    console.error("[notices] status change failed", error);
    return false;
  }
  return true;
}

export async function deleteNotice(id: string): Promise<boolean> {
  const { error } = await supabase.from("notices").delete().eq("id", id);
  if (error) {
    console.error("[notices] delete failed", error);
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

/**
 * Upload one document against a notice.
 *
 * The key leads with the notice id because that is what the storage policy
 * checks — the same shape mentor attachments use. The row in
 * notice_attachments is written after the object lands, so a failed upload
 * never leaves a link to a file that is not there.
 */
export async function uploadNoticeFile(
  noticeId: string,
  file: File,
  sortOrder = 0,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return { ok: false, error: `${file.name} is larger than 20 MB.` };
  }
  if (file.type && !ALLOWED_MIME.includes(file.type)) {
    return {
      ok: false,
      error: `${file.name} is a ${file.type} file. Notices take PDFs, images, Office documents and plain text.`,
    };
  }

  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const path = `${noticeId}/${crypto.randomUUID()}-${safe}`;

  const { error: upErr } = await supabase.storage
    .from(NOTICE_BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  if (upErr) return { ok: false, error: `Could not upload ${file.name}.` };

  const { error: rowErr } = await supabase.from("notice_attachments").insert({
    notice_id: noticeId,
    path,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
    sort_order: sortOrder,
  });
  if (rowErr) {
    // Don't leave an orphan object behind if the row could not be written.
    await supabase.storage.from(NOTICE_BUCKET).remove([path]);
    return { ok: false, error: `Could not attach ${file.name}.` };
  }
  return { ok: true };
}

export async function removeNoticeFile(
  attachmentId: string,
  path: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("notice_attachments")
    .delete()
    .eq("id", attachmentId);
  if (error) {
    console.error("[notices] detach failed", error);
    return false;
  }
  await supabase.storage.from(NOTICE_BUCKET).remove([path]);
  return true;
}

/** A short-lived link, signed only once the database has allowed the read. */
export async function noticeFileUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(NOTICE_BUCKET)
    .createSignedUrl(path, 3600);
  if (error) {
    console.error("[notices] signed url failed", error);
    return null;
  }
  return data?.signedUrl ?? null;
}

/** Forces a save-as rather than opening in the tab. */
export async function noticeFileDownloadUrl(
  path: string,
  fileName: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(NOTICE_BUCKET)
    .createSignedUrl(path, 3600, { download: fileName });
  if (error) {
    console.error("[notices] download url failed", error);
    return null;
  }
  return data?.signedUrl ?? null;
}

/* ------------------------------------------------------------------ */

function friendly(message: string): string {
  if (/row-level security/i.test(message)) {
    return "You are not allowed to publish a notice with that scope. Check the department, course and category.";
  }
  if (/notices_published_has_date/i.test(message)) {
    return "A published notice needs a publication date.";
  }
  if (/notices_expiry_after_publication/i.test(message)) {
    return "The expiry date has to be after the publication date.";
  }
  if (/notices_title_check|length/i.test(message)) {
    return "The title needs to be between 3 and 200 characters.";
  }
  return message;
}

/** Human file size, for the attachment row. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What a notice is aimed at, as one readable line. */
export function describeScope(n: {
  department: string | null;
  batch_year: number | null;
  semester: number | null;
  course_code: string | null;
}): string {
  const parts: string[] = [];
  if (n.course_code) parts.push(n.course_code);
  parts.push(n.department ?? "All departments");
  if (n.batch_year) parts.push(`Batch ${n.batch_year}`);
  if (n.semester) parts.push(`Semester ${n.semester}`);
  return parts.join(" · ");
}
