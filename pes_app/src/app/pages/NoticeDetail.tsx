import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  Megaphone,
  Paperclip,
  Pin,
} from "lucide-react";
import { Button } from "../components/ui/button";
import {
  EmptyState,
  PageHeader,
  SectionCard,
  SkeletonRows,
  StatusBadge,
} from "../components/common";
import { categoryIcon, noticeAge } from "../components/notices/NoticeCard";
import { notifyCountsChanged } from "../hooks/useNotificationCounts";
import {
  describeScope,
  fetchNotice,
  markNoticeRead,
  formatBytes,
  noticeFileDownloadUrl,
  noticeFileUrl,
  type NoticeAttachment,
  type NoticeDetail as Detail,
} from "../../lib/notices";

/**
 * One notice, and its documents.
 *
 * A student who reaches here by guessing an id gets the same empty state as
 * one following a stale link, because get_notice applies the visibility rule
 * rather than trusting the id in the URL. There is nothing to leak by
 * enumerating: an unauthorised id and a deleted id are indistinguishable.
 */
export default function NoticeDetail() {
  const { noticeId } = useParams<{ noticeId: string }>();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!noticeId) return;
    setLoading(true);
    fetchNotice(noticeId).then(async (n) => {
      setNotice(n);
      setLoading(false);
      /* Reading it is what clears the sidebar count, and only if there was
         something to read — marking a notice they were never told about
         would make the badge lie in the other direction. */
      if (n) {
        await markNoticeRead(n.id);
        notifyCountsChanged();
      }
    });
  }, [noticeId]);

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader title="Notice" />
        <SectionCard title="Loading">
          <SkeletonRows count={4} />
        </SectionCard>
      </div>
    );
  }

  if (!notice) {
    return (
      <div className="space-y-5">
        <PageHeader title="Notice" />
        <EmptyState
          icon={Megaphone}
          title="This notice is not available to you"
          description="It may have been taken down, or it was never meant for your department or batch."
          action={
            <Button variant="outline" onClick={() => navigate("/app/notices")}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back to notices
            </Button>
          }
        />
      </div>
    );
  }

  const Icon = categoryIcon(notice.category_icon);
  const pdfs = notice.attachments.filter(
    (a) => a.mime_type === "application/pdf",
  );

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        onClick={() => navigate("/app/notices")}
      >
        <ArrowLeft className="mr-1.5 h-4 w-4" />
        Back to notices
      </Button>

      <SectionCard title="" flush>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {notice.category_label}
            </span>
            {notice.is_pinned && (
              <StatusBadge tone="danger" icon={Pin}>
                Important
              </StatusBadge>
            )}
            {notice.is_expired && (
              <StatusBadge tone="neutral">Expired</StatusBadge>
            )}
            {notice.status !== "published" && (
              <StatusBadge tone="warning">{notice.status}</StatusBadge>
            )}
          </div>

          <h1 className="text-xl font-bold text-foreground">{notice.title}</h1>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <Field label="Published by">
              {notice.created_by_name}
              <span className="block text-xs text-muted-foreground">
                {notice.created_by_role}
              </span>
            </Field>
            <Field label="Published">{noticeAge(notice.published_at)}</Field>
            <Field label="For">{describeScope(notice)}</Field>
            <Field label="Academic year">{notice.academic_year ?? "—"}</Field>
          </dl>

          {notice.body && (
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {notice.body}
            </p>
          )}

          {notice.expires_at && (
            <p className="text-xs text-muted-foreground">
              {notice.is_expired ? "Expired on " : "Valid until "}
              {new Date(notice.expires_at).toLocaleDateString(undefined, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          )}
        </div>
      </SectionCard>

      {notice.attachments.length > 0 && (
        <SectionCard
          title="Documents"
          description={`${notice.attachments.length} file${notice.attachments.length === 1 ? "" : "s"}`}
          flush
        >
          <ul className="divide-y divide-border/60">
            {notice.attachments.map((a) => (
              <li key={a.id}>
                <AttachmentRow attachment={a} />
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* The document most people came for, without a round trip through
          the download folder. */}
      {pdfs.length > 0 && <PdfPreview attachment={pdfs[0]} />}
    </div>
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
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}

function AttachmentRow({ attachment }: { attachment: NoticeAttachment }) {
  const [busy, setBusy] = useState<"view" | "download" | null>(null);

  /* Signed when asked for, never held: a link that outlives the page is a
     link that outlives the permission that produced it. */
  const open = async (mode: "view" | "download") => {
    setBusy(mode);
    const url =
      mode === "download"
        ? await noticeFileDownloadUrl(attachment.path, attachment.file_name)
        : await noticeFileUrl(attachment.path);
    setBusy(null);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <FileText
        className="h-4 w-4 flex-shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">
          {attachment.file_name}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(attachment.size_bytes)}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy !== null}
        onClick={() => open("view")}
      >
        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
        {busy === "view" ? "Opening..." : "View"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy !== null}
        onClick={() => open("download")}
      >
        <Download className="mr-1.5 h-3.5 w-3.5" />
        {busy === "download" ? "..." : "Download"}
      </Button>
    </div>
  );
}

function PdfPreview({ attachment }: { attachment: NoticeAttachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    noticeFileUrl(attachment.path).then((u) => {
      if (cancelled) return;
      if (u) setUrl(u);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.path]);

  if (failed) return null;

  return (
    <SectionCard
      title="Preview"
      description={attachment.file_name}
      flush
    >
      {url ? (
        <iframe
          src={url}
          title={`Preview of ${attachment.file_name}`}
          className="h-[70vh] w-full rounded-b-xl border-0 bg-muted"
        />
      ) : (
        <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Paperclip className="h-4 w-4" />
          Preparing preview...
        </div>
      )}
    </SectionCard>
  );
}
