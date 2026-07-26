import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  FileHeart,
  Search,
  Clock,
  CheckCircle2,
  XCircle,
  Paperclip,
  Mail,
  Calendar,
  AlertCircle,
  Users,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Badge } from "../../components/ui/badge";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { describeAdminScope } from "../../../lib/adminScope";
import { describeBatch } from "../../../lib/batch";
import { formatRegNumber } from "../../../lib/format";

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

export default function AdminMedical() {
  const { student: admin } = useAuth();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
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
    setActionError(null);
    if (signedUrls[fileKey]) {
      window.open(signedUrls[fileKey], "_blank");
      return;
    }
    const { data, error } = await supabase.storage
      .from("medical-certificates")
      .createSignedUrl(fileUrl, 60 * 10);

    if (error || !data?.signedUrl) {
      setActionError("Could not open this file. Please try again.");
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
    setActionError(null);
    setActionNotice(null);

    const { data, error } = await supabase.rpc(
      "review_medical_submission_course",
      {
        p_msc_id: mscId,
        p_decision: decision,
        p_notes: reviewNotes || null,
      },
    );

    if (error) {
      setActionError(error.message || "This course item could not be reviewed.");
      setSavingItem(null);
      return;
    }

    setActionNotice(data?.message ?? "Review saved.");
    setReviewingItem(null);
    setReviewNotes("");
    setSavingItem(null);
    await fetchSubmissions();
  };

  const itemBadge = (status: string) => {
    if (status === "approved")
      return (
        <Badge className="bg-green-100 text-green-700">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Approved
        </Badge>
      );
    if (status === "rejected")
      return (
        <Badge className="bg-red-100 text-red-700">
          <XCircle className="h-3 w-3 mr-1" />
          Rejected
        </Badge>
      );
    return (
      <Badge className="bg-amber-100 text-amber-800">
        <Clock className="h-3 w-3 mr-1" />
        Pending
      </Badge>
    );
  };

  const overallBadge = (status: string) => {
    const styles: Record<string, string> = {
      approved: "bg-green-100 text-green-700",
      rejected: "bg-red-100 text-red-700",
      pending: "bg-amber-100 text-amber-800",
      partially_approved: "bg-blue-100 text-blue-700",
      mixed: "bg-purple-100 text-purple-700",
    };
    return (
      <Badge className={styles[status] ?? "bg-muted text-muted-foreground"}>
        {OVERALL_STATUS_LABELS[status] ?? status}
      </Badge>
    );
  };

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
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-foreground mb-1">
          Medical Submissions
        </h1>
        <p className="text-muted-foreground text-sm">
          Submissions covering courses in {describeAdminScope(admin)}.
        </p>
      </motion.div>

      {actionError && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {actionError}
        </div>
      )}
      {actionNotice && (
        <div className="p-3 rounded-xl bg-green-50 border border-green-200 flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {actionNotice}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by student name, reg number, or course code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 bg-card border-border"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(
            [
              { value: "pending", label: `Pending (${pendingCount})` },
              { value: "approved", label: "Approved" },
              { value: "rejected", label: "Rejected" },
              { value: "all", label: "All" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className="px-3 py-2 rounded-lg text-sm font-medium transition-all"
              style={
                statusFilter === opt.value
                  ? { backgroundColor: "#C41E3A", color: "white" }
                  : {}
              }
            >
              <span
                className={
                  statusFilter === opt.value
                    ? "text-white"
                    : "text-muted-foreground"
                }
              >
                {opt.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
          Batch:
        </label>
        <select
          value={batchFilter}
          onChange={(e) =>
            setBatchFilter(
              e.target.value === "all" ? "all" : Number(e.target.value),
            )
          }
          className="h-9 px-3 rounded-xl border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="all">All Batches</option>
          {batches.map((b) => (
            <option key={b} value={b}>
              {describeBatch(b)}
            </option>
          ))}
        </select>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle>
            Submissions{" "}
            <span className="text-muted-foreground font-normal text-sm">
              ({filtered.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : loadError ? (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-3" />
              <p className="text-red-600 font-medium mb-3">{loadError}</p>
              <Button size="sm" variant="outline" onClick={fetchSubmissions}>
                Try again
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <FileHeart className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-muted-foreground">No submissions found.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {Object.entries(groupedByBatch).map(([batchKey, batchSubs]) => (
                <div key={batchKey}>
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    {batchKey === "unknown"
                      ? "Unknown Batch"
                      : describeBatch(Number(batchKey))}{" "}
                    <span className="font-normal normal-case">
                      ({batchSubs.length})
                    </span>
                  </h4>
                  <div className="space-y-3">
                    {batchSubs.map((sub, index) => (
                      <motion.div
                        key={sub.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: index * 0.03 }}
                        className="p-3 rounded-xl border border-border bg-card"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-foreground">
                                {sub.studentName}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {sub.studentReg}
                              </span>
                              {sub.studentIndexNumber && (
                                <span className="text-xs text-muted-foreground">
                                  {sub.studentIndexNumber}
                                </span>
                              )}
                              <Badge variant="outline" className="text-xs">
                                {REASON_LABELS[sub.reasonType] ?? "Other"}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {sub.studentDepartment ?? "—"}
                              {sub.studentBatchYear
                                ? ` · ${describeBatch(sub.studentBatchYear)}`
                                : ""}
                            </p>
                          </div>
                          {overallBadge(sub.overallStatus)}
                        </div>

                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                          <Calendar className="h-3 w-3" />
                          {sub.missedDate}
                          {sub.endDate ? ` → ${sub.endDate}` : ""} · Submitted{" "}
                          {new Date(sub.submittedAt).toLocaleDateString()}
                        </div>

                        {sub.description && (
                          <p className="text-sm text-foreground/80 mb-2">
                            {sub.description}
                          </p>
                        )}

                        <div className="space-y-2 mb-2">
                          {sub.myItems.map((item) => (
                            <div
                              key={item.mscId}
                              className="p-2.5 rounded-lg border border-border/70 bg-muted/30"
                            >
                              <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge className="bg-primary/10 text-primary text-xs">
                                    {item.courseCode}
                                  </Badge>
                                  <span className="text-sm text-foreground">
                                    {item.courseTitle}
                                  </span>
                                </div>
                                {itemBadge(item.reviewStatus)}
                              </div>

                              {item.reviewNotes && item.reviewStatus !== "pending" && (
                                <p className="text-xs text-muted-foreground bg-background rounded-lg p-2 mt-1">
                                  <strong>Notes:</strong> {item.reviewNotes}
                                </p>
                              )}

                              {item.reviewStatus === "pending" && (
                                <div className="pt-1.5">
                                  {reviewingItem === item.mscId ? (
                                    <div className="space-y-2">
                                      <Textarea
                                        placeholder="Optional review notes (shown to the student, especially for rejections)..."
                                        value={reviewNotes}
                                        onChange={(e) => setReviewNotes(e.target.value)}
                                        rows={2}
                                      />
                                      <div className="flex items-center gap-2">
                                        <Button
                                          size="sm"
                                          className="bg-green-600 hover:bg-green-700"
                                          disabled={savingItem === item.mscId}
                                          onClick={() => handleReview(item.mscId, "approved")}
                                        >
                                          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                                          Approve
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="border-red-300 text-red-700 hover:bg-red-50"
                                          disabled={savingItem === item.mscId}
                                          onClick={() => handleReview(item.mscId, "rejected")}
                                        >
                                          <XCircle className="h-3.5 w-3.5 mr-1.5" />
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
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        setReviewingItem(item.mscId);
                                        setReviewNotes("");
                                        setActionError(null);
                                        setActionNotice(null);
                                      }}
                                    >
                                      Review
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        {sub.otherDeptPendingCount > 0 && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded-lg px-2.5 py-1.5 mb-2">
                            <Users className="h-3 w-3 flex-shrink-0" />
                            {sub.otherDeptPendingCount} course item
                            {sub.otherDeptPendingCount > 1 ? "s" : ""} from another
                            department {sub.otherDeptPendingCount > 1 ? "are" : "is"}{" "}
                            still awaiting review.
                          </div>
                        )}

                        <div className="flex items-center gap-3 flex-wrap">
                          {sub.files.length === 0 ? (
                            <span className="text-xs text-muted-foreground">
                              No files attached
                            </span>
                          ) : (
                            sub.files.map((f) => (
                              <button
                                key={f.id}
                                onClick={() => handleViewFile(f.id, f.file_url)}
                                className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                              >
                                <Paperclip className="h-3 w-3" />
                                {f.file_name}
                              </button>
                            ))
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
