import { useState, useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  FileHeart,
  Clock,
  CheckCircle2,
  XCircle,
  Paperclip,
  Calendar,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  CourseCode,
  EmptyState,
  ErrorState,
  PageHeader,
  PillTabs,
  SearchField,
  SectionCard,
  SkeletonRows,
  StatusBadge,
  useExpandMotion,
  type StatusTone,
} from "../../components/common";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { describeAdminReach } from "../../../lib/adminScope";
import { describeBatch } from "../../../lib/batch";
import { formatRegNumber } from "../../../lib/format";
import { courseRowClass } from "../../../lib/departments";

const REASON_LABELS: Record<string, string> = {
  medical: "Medical",
  bereavement: "Bereavement",
  other: "Other valid reason",
};

interface SubmissionItem {
  mscId: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  department: string;
  reviewStatus: "pending" | "approved" | "rejected";
  reviewedAt: string | null;
  reviewNotes: string | null;
}

interface SubmissionFile {
  id: string;
  file_url: string;
  file_name: string;
}

interface Submission {
  id: string;
  studentName: string;
  studentReg: string;
  studentIndexNumber: string | null;
  studentBatchYear: number | null;
  studentDepartment: string | null;
  reasonType: string;
  missedDate: string;
  endDate: string | null;
  description: string | null;
  submittedAt: string;
  overallStatus: string;
  myItems: SubmissionItem[];
  otherDeptPendingCount: number;
  files: SubmissionFile[];
}

const OVERALL_STATUS_LABELS: Record<string, string> = {
  pending: "Pending Review",
  partially_approved: "Partially Approved",
  approved: "Approved",
  rejected: "Rejected",
  mixed: "Mixed Decision",
};

const OVERALL_STATUS_TONE: Record<string, StatusTone> = {
  approved: "success",
  rejected: "danger",
  pending: "warning",
  partially_approved: "info",
  mixed: "warning",
};

export default function AdminMedical() {
  const { student: admin } = useAuth();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const expand = useExpandMotion();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "pending" | "approved" | "rejected" | "all"
  >("pending");
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [reviewingItem, setReviewingItem] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [savingItem, setSavingItem] = useState<string | null>(null);
  const [batches, setBatches] = useState<number[]>([]);
  const [batchFilter, setBatchFilter] = useState<number | "all">("all");

  useEffect(() => {
    if (admin) {
      fetchSubmissions();
      fetchBatches();
    }
  }, [admin]);

  const fetchBatches = async () => {
    const { data, error } = await supabase
      .from("students")
      .select("batch_year")
      .eq("role", "student");

    if (error) return;
    const distinct = [...new Set((data ?? []).map((s: any) => s.batch_year))]
      .filter((y): y is number => y !== null)
      .sort((a, b) => b - a);
    setBatches(distinct);
  };

  const fetchSubmissions = async () => {
    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase.rpc("get_admin_medical_submissions");

    if (error) {
      console.error(error);
      setLoadError("The medical submission could not be loaded.");
      setSubmissions([]);
      setLoading(false);
      return;
    }

    setSubmissions(
      (data ?? []).map((s: any) => ({
        id: s.id,
        studentName: s.student_name ?? "—",
        studentReg: formatRegNumber(s.student_reg_number),
        studentIndexNumber: s.student_index_number,
        studentBatchYear: s.student_batch_year,
        studentDepartment: s.student_department,
        reasonType: s.reason_type,
        missedDate: s.missed_date,
        endDate: s.end_date,
        description: s.description,
        submittedAt: s.submitted_at,
        overallStatus: s.overall_status,
        myItems: (s.my_items ?? []).map((it: any) => ({
          mscId: it.msc_id,
          courseId: it.course_id,
          courseCode: it.course_code,
          courseTitle: it.course_title,
          department: it.department,
          reviewStatus: it.review_status,
          reviewedAt: it.reviewed_at,
          reviewNotes: it.review_notes,
        })),
        otherDeptPendingCount: s.other_departments_pending_count ?? 0,
        files: s.files ?? [],
      })),
    );
    setLoading(false);
  };

  const handleViewFile = async (fileKey: string, fileUrl: string) => {
    if (signedUrls[fileKey]) {
      window.open(signedUrls[fileKey], "_blank");
      return;
    }
    const { data, error } = await supabase.storage
      .from("medical-certificates")
      .createSignedUrl(fileUrl, 60 * 10);

    if (error || !data?.signedUrl) {
      toast.error("Could not open this file. Please try again.");
      return;
    }
    setSignedUrls((prev) => ({ ...prev, [fileKey]: data.signedUrl }));
    window.open(data.signedUrl, "_blank");
  };

  const handleReview = async (
    mscId: string,
    decision: "approved" | "rejected",
  ) => {
    setSavingItem(mscId);

    const { data, error } = await supabase.rpc(
      "review_medical_submission_course",
      {
        p_msc_id: mscId,
        p_decision: decision,
        p_notes: reviewNotes || null,
      },
    );

    if (error) {
      toast.error(error.message || "This course item could not be reviewed.");
      setSavingItem(null);
      return;
    }

    toast.success(data?.message ?? "Review saved.");
    setReviewingItem(null);
    setReviewNotes("");
    setSavingItem(null);
    await fetchSubmissions();
  };

  const itemBadge = (status: string) =>
    status === "approved" ? (
      <StatusBadge tone="success" icon={CheckCircle2}>Approved</StatusBadge>
    ) : status === "rejected" ? (
      <StatusBadge tone="danger" icon={XCircle}>Rejected</StatusBadge>
    ) : (
      <StatusBadge tone="warning" icon={Clock}>Pending</StatusBadge>
    );

  const overallBadge = (status: string) => (
    <StatusBadge tone={OVERALL_STATUS_TONE[status] ?? "neutral"}>
      {OVERALL_STATUS_LABELS[status] ?? status}
    </StatusBadge>
  );

  // A submission's relevance to the "my status" filter is judged by this
  // admin's own course items only — not the submission's overall status,
  // which may reflect another department's decision this admin can't see.
  const myStatus = (sub: Submission): "pending" | "approved" | "rejected" | "mixed" => {
    const statuses = sub.myItems.map((i) => i.reviewStatus);
    if (statuses.every((s) => s === "pending")) return "pending";
    if (statuses.every((s) => s === "approved")) return "approved";
    if (statuses.every((s) => s === "rejected")) return "rejected";
    return "mixed";
  };

  const filtered = submissions.filter((s) => {
    if (s.myItems.length === 0) return false;
    const mine = myStatus(s);
    const matchStatus =
      statusFilter === "all" ||
      mine === statusFilter ||
      (statusFilter !== "pending" && mine === "mixed");
    const matchBatch =
      batchFilter === "all" || s.studentBatchYear === batchFilter;
    const q = searchQuery.toLowerCase();
    const matchSearch =
      !q ||
      s.studentName.toLowerCase().includes(q) ||
      s.studentReg.toLowerCase().includes(q) ||
      s.myItems.some((c) => c.courseCode.toLowerCase().includes(q));
    return matchStatus && matchBatch && matchSearch;
  });

  const groupedByBatch = [...filtered]
    .sort((a, b) => (b.studentBatchYear ?? 0) - (a.studentBatchYear ?? 0))
    .reduce<Record<string, Submission[]>>((groups, sub) => {
      const key = sub.studentBatchYear?.toString() ?? "unknown";
      (groups[key] ??= []).push(sub);
      return groups;
    }, {});

  const pendingCount = submissions.filter(
    (s) => myStatus(s) === "pending" || myStatus(s) === "mixed",
  ).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Medical Submissions"
        description={`Submissions covering courses ${admin?.role === "super_admin" ? "across" : "in"} ${describeAdminReach(admin)}.`}
      />

      {/* One row of controls: search, the review status, the batch */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchField
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by student name, reg number, or course code"
          label="Search submissions"
        />
        <div className="flex flex-wrap items-center gap-2">
          <PillTabs
            aria-label="Filter by review status"
            layoutId="admin-medical-status"
            scrollable
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as typeof statusFilter)}
            tabs={[
              { value: "pending", label: "Pending", count: pendingCount },
              { value: "approved", label: "Approved" },
              { value: "rejected", label: "Rejected" },
              { value: "all", label: "All" },
            ]}
          />
          <Select
            value={String(batchFilter)}
            onValueChange={(v) => setBatchFilter(v === "all" ? "all" : Number(v))}
          >
            <SelectTrigger aria-label="Batch" className="h-9 w-48 rounded-control bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Batches</SelectItem>
              {batches.map((b) => (
                <SelectItem key={b} value={String(b)}>
                  {describeBatch(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <SectionCard
        title={
          <>
            Submissions{" "}
            <span className="text-sm font-normal text-muted-foreground">({filtered.length})</span>
          </>
        }
        bodyClassName="space-y-6"
      >
        {loading ? (
          <SkeletonRows count={3} height="h-28" />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={fetchSubmissions} size="inline" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FileHeart}
            title="No submissions found."
            description={statusFilter === "pending" ? "Nothing is waiting for a decision." : undefined}
            size="inline"
          />
        ) : (
          Object.entries(groupedByBatch).map(([batchKey, batchSubs]) => (
            <section key={batchKey}>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {batchKey === "unknown" ? "Unknown Batch" : describeBatch(Number(batchKey))}
                <span className="rounded-full bg-muted px-2 py-0.5 font-medium normal-case tracking-normal">
                  {batchSubs.length}
                </span>
              </h3>
              <div className="grid gap-3 xl:grid-cols-2">
                {batchSubs.map((sub, index) => (
                  <motion.article
                    key={sub.id}
                    initial={reduce ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: reduce ? 0 : Math.min(index * 0.03, 0.2) }}
                    className="flex flex-col rounded-card border border-border bg-card p-4"
                  >
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-foreground">{sub.studentName}</span>
                          <StatusBadge tone="neutral">{REASON_LABELS[sub.reasonType] ?? "Other"}</StatusBadge>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {sub.studentReg}
                          {sub.studentIndexNumber ? ` · ${sub.studentIndexNumber}` : ""} ·{" "}
                          {sub.studentDepartment ?? "—"}
                          {sub.studentBatchYear ? ` · ${describeBatch(sub.studentBatchYear)}` : ""}
                        </p>
                      </div>
                      {overallBadge(sub.overallStatus)}
                    </div>

                    <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" aria-hidden="true" />
                      {sub.missedDate}
                      {sub.endDate ? ` → ${sub.endDate}` : ""} · Submitted{" "}
                      {new Date(sub.submittedAt).toLocaleDateString()}
                    </p>

                    {sub.description && (
                      <p className="mb-2 text-sm text-foreground/80">{sub.description}</p>
                    )}

                    <div className="mb-2 space-y-2">
                      {sub.myItems.map((item) => (
                        <div
                          key={item.mscId}
                          className={`rounded-control border border-border/70 bg-muted/30 p-2.5 transition-colors ${courseRowClass(item.courseCode)}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <CourseCode code={item.courseCode} className="flex-shrink-0 text-xs" />
                              <span className="text-sm text-foreground">{item.courseTitle}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {itemBadge(item.reviewStatus)}
                              {item.reviewStatus === "pending" && reviewingItem !== item.mscId && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7"
                                  onClick={() => {
                                    setReviewingItem(item.mscId);
                                    setReviewNotes("");
                                  }}
                                >
                                  Review
                                </Button>
                              )}
                            </div>
                          </div>

                          {item.reviewNotes && item.reviewStatus !== "pending" && (
                            <p className="mt-1.5 rounded-control bg-background p-2 text-xs text-muted-foreground">
                              <strong>Notes:</strong> {item.reviewNotes}
                            </p>
                          )}

                          {/* The decision, opened in place */}
                          <AnimatePresence initial={false}>
                            {item.reviewStatus === "pending" && reviewingItem === item.mscId && (
                              <motion.div
                                key="review"
                                variants={expand}
                                initial="collapsed"
                                animate="open"
                                exit="collapsed"
                                className="overflow-hidden"
                              >
                                <div className="space-y-2 pt-2">
                                  <Textarea
                                    placeholder="Optional review notes (shown to the student, especially for rejections)..."
                                    value={reviewNotes}
                                    onChange={(e) => setReviewNotes(e.target.value)}
                                    rows={2}
                                    className="bg-card"
                                  />
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                      size="sm"
                                      className="bg-[var(--success-600)] text-white hover:bg-[var(--success-700)]"
                                      disabled={savingItem === item.mscId}
                                      onClick={() => handleReview(item.mscId, "approved")}
                                    >
                                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-danger-border text-danger-fg hover:bg-danger-bg"
                                      disabled={savingItem === item.mscId}
                                      onClick={() => handleReview(item.mscId, "rejected")}
                                    >
                                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                                      Reject
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={savingItem === item.mscId}
                                      onClick={() => {
                                        setReviewingItem(null);
                                        setReviewNotes("");
                                      }}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ))}
                    </div>

                    {sub.otherDeptPendingCount > 0 && (
                      <p className="mb-2 flex items-center gap-1.5 rounded-control bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                        <Users className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                        {sub.otherDeptPendingCount} course item
                        {sub.otherDeptPendingCount > 1 ? "s" : ""} from another department{" "}
                        {sub.otherDeptPendingCount > 1 ? "are" : "is"} still awaiting review.
                      </p>
                    )}

                    <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-border/60 pt-2">
                      {sub.files.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No files attached</span>
                      ) : (
                        sub.files.map((f) => (
                          <button
                            key={f.id}
                            onClick={() => handleViewFile(f.id, f.file_url)}
                            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                          >
                            <Paperclip className="h-3 w-3" aria-hidden="true" />
                            {f.file_name}
                          </button>
                        ))
                      )}
                    </div>
                  </motion.article>
                ))}
              </div>
            </section>
          ))
        )}
      </SectionCard>
    </div>
  );
}
