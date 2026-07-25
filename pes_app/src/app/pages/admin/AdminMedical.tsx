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

interface SubmissionCourse {
  code: string;
  title: string;
  department: string;
}

interface SubmissionFile {
  id: string;
  file_url: string;
  file_name: string;
}

interface Submission {
  id: string;
  reason_type: string;
  missed_date: string;
  end_date: string | null;
  description: string | null;
  status: string;
  submitted_at: string;
  review_notes: string | null;
  studentName: string;
  studentReg: string;
  studentEmail: string;
  studentBatchYear: number | null;
  courses: SubmissionCourse[];
  files: SubmissionFile[];
}

export default function AdminMedical() {
  const { student: admin } = useAuth();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "approved" | "rejected"
  >("pending");
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [batches, setBatches] = useState<number[]>([]);
  const [batchFilter, setBatchFilter] = useState<number | "all">("all");

  useEffect(() => {
    if (admin) {
      fetchSubmissions();
      fetchBatches();
    }
  }, [admin]);

  // Sourced from real students, not from existing submissions — otherwise
  // the batch selector would stay empty until a submission happened to
  // exist for that batch.
  const fetchBatches = async () => {
    const { data } = await supabase
      .from("students")
      .select("batch_year")
      .eq("role", "student");

    const distinct = [...new Set((data ?? []).map((s: any) => s.batch_year))]
      .filter((y): y is number => y !== null)
      .sort((a, b) => b - a);
    setBatches(distinct);
  };

  const fetchSubmissions = async () => {
    setLoading(true);

    const { data } = await supabase
      .from("medical_submissions")
      .select(
        `
        id, reason_type, missed_date, end_date, description, status,
        submitted_at, review_notes,
        students ( name, reg_number, email, batch_year ),
        medical_submission_courses ( courses ( course_code, title, department ) ),
        medical_submission_files ( id, file_url, file_name )
      `,
      )
      .order("submitted_at", { ascending: false });

    setSubmissions(
      (data ?? []).map((s: any) => ({
        id: s.id,
        reason_type: s.reason_type,
        missed_date: s.missed_date,
        end_date: s.end_date,
        description: s.description,
        status: s.status,
        submitted_at: s.submitted_at,
        review_notes: s.review_notes,
        studentName: s.students?.name ?? "—",
        studentReg: formatRegNumber(s.students?.reg_number),
        studentEmail: s.students?.email ?? "—",
        studentBatchYear: s.students?.batch_year ?? null,
        courses: (s.medical_submission_courses ?? [])
          .map((link: any) => link.courses)
          .filter(Boolean)
          .map((c: any) => ({
            code: c.course_code,
            title: c.title,
            department: c.department,
          })),
        files: s.medical_submission_files ?? [],
      })),
    );
    setLoading(false);
  };

  const handleViewFile = async (fileKey: string, fileUrl: string) => {
    if (signedUrls[fileKey]) {
      window.open(signedUrls[fileKey], "_blank");
      return;
    }
    const { data } = await supabase.storage
      .from("medical-certificates")
      .createSignedUrl(fileUrl, 60 * 10);

    if (data?.signedUrl) {
      setSignedUrls((prev) => ({ ...prev, [fileKey]: data.signedUrl }));
      window.open(data.signedUrl, "_blank");
    }
  };

  const handleReview = async (
    submissionId: string,
    decision: "approved" | "rejected",
  ) => {
    setSaving(true);
    await supabase
      .from("medical_submissions")
      .update({
        status: decision,
        review_notes: reviewNotes || null,
        reviewed_by: admin?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", submissionId);

    setReviewingId(null);
    setReviewNotes("");
    setSaving(false);
    await fetchSubmissions();
  };

  const statusBadge = (status: string) => {
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
        Pending Review
      </Badge>
    );
  };

  const filtered = submissions.filter((s) => {
    const matchStatus = statusFilter === "all" || s.status === statusFilter;
    const matchBatch =
      batchFilter === "all" || s.studentBatchYear === batchFilter;
    const q = searchQuery.toLowerCase();
    const matchSearch =
      !q ||
      s.studentName.toLowerCase().includes(q) ||
      s.studentReg.toLowerCase().includes(q) ||
      s.courses.some((c) => c.code.toLowerCase().includes(q));
    return matchStatus && matchBatch && matchSearch;
  });

  const groupedByBatch = [...filtered]
    .sort((a, b) => (b.studentBatchYear ?? 0) - (a.studentBatchYear ?? 0))
    .reduce<Record<string, Submission[]>>((groups, sub) => {
      const key = sub.studentBatchYear?.toString() ?? "unknown";
      (groups[key] ??= []).push(sub);
      return groups;
    }, {});

  const pendingCount = submissions.filter((s) => s.status === "pending").length;

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
                              <Badge variant="outline" className="text-xs">
                                {REASON_LABELS[sub.reason_type] ?? "Other"}
                              </Badge>
                            </div>
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {sub.studentEmail}
                      </p>
                    </div>
                    {statusBadge(sub.status)}
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                    <Calendar className="h-3 w-3" />
                    {sub.missed_date}
                    {sub.end_date ? ` → ${sub.end_date}` : ""} · Submitted{" "}
                    {new Date(sub.submitted_at).toLocaleDateString()}
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap mb-2">
                    {sub.courses.map((c) => (
                      <Badge
                        key={c.code}
                        className="bg-primary/10 text-primary text-xs"
                        title={c.department}
                      >
                        {c.code} — {c.title}
                      </Badge>
                    ))}
                  </div>

                  {sub.description && (
                    <p className="text-sm text-foreground/80 mb-2">
                      {sub.description}
                    </p>
                  )}

                  {sub.review_notes && sub.status !== "pending" && (
                    <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-2 mb-2">
                      <strong>Review notes:</strong> {sub.review_notes}
                    </p>
                  )}

                  <div className="flex items-center gap-3 flex-wrap mb-2">
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

                  {sub.status === "pending" && (
                    <div className="pt-2 border-t border-border">
                      {reviewingId === sub.id ? (
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
                              disabled={saving}
                              onClick={() => handleReview(sub.id, "approved")}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-300 text-red-700 hover:bg-red-50"
                              disabled={saving}
                              onClick={() => handleReview(sub.id, "rejected")}
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1.5" />
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={saving}
                              onClick={() => {
                                setReviewingId(null);
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
                            setReviewingId(sub.id);
                            setReviewNotes("");
                          }}
                        >
                          Review Submission
                        </Button>
                      )}
                    </div>
                  )}
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
