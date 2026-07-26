import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  FileHeart,
  Upload,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Paperclip,
  Loader2,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { Checkbox } from "../components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/AuthContext";

const REASON_LABELS: Record<string, string> = {
  medical: "Medical",
  bereavement: "Bereavement",
  other: "Other valid reason",
};

interface EnrolledCourse {
  id: string;
  code: string;
  title: string;
}

interface SubmissionFile {
  id: string;
  file_url: string;
  file_name: string;
}

interface SubmissionCourseStatus {
  code: string;
  title: string;
  department: string;
  reviewStatus: "pending" | "approved" | "rejected";
  reviewNotes: string | null;
  excusedDays: number;
}

interface Submission {
  id: string;
  reason_type: string;
  missed_date: string;
  end_date: string | null;
  description: string | null;
  status: string;
  deadline: string | null;
  submitted_at: string;
  review_notes: string | null;
  courses: SubmissionCourseStatus[];
  files: SubmissionFile[];
}

const OVERALL_STATUS_LABELS: Record<string, string> = {
  pending: "Pending Review",
  partially_approved: "Partially Approved",
  approved: "Approved",
  rejected: "Rejected",
  mixed: "Mixed Decision",
};

const daysBetween = (a: Date, b: Date) =>
  Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));

export default function MedicalCertificates() {
  const { student } = useAuth();

  const [courses, setCourses] = useState<EnrolledCourse[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  // form state
  const [reasonType, setReasonType] = useState("medical");
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!student?.id) return;
    fetchData();
  }, [student?.id]);

  const fetchData = async () => {
    setLoading(true);
    setLoadError(null);

    // Courses the student is currently taking this semester — the only
    // ones a medical excuse can reasonably apply to.
    const { data: enrollments, error: enrollError } = await supabase
      .from("enrollments")
      .select("courses(id, course_code, title)")
      .eq("student_id", student!.id)
      .eq("status", "enrolled");

    if (enrollError) {
      setLoadError("The medical submission could not be loaded.");
      setLoading(false);
      return;
    }

    setCourses(
      (enrollments ?? [])
        .map((e: any) => e.courses)
        .filter(Boolean)
        .map((c: any) => ({ id: c.id, code: c.course_code, title: c.title })),
    );

    const { data: subs, error: subsError } = await supabase
      .from("medical_submissions")
      .select(
        `
        id, reason_type, missed_date, end_date, description,
        status, deadline, submitted_at, review_notes,
        medical_submission_courses (
          course_id, review_status, review_notes, department,
          courses ( course_code, title )
        ),
        medical_submission_files ( id, file_url, file_name )
      `,
      )
      .eq("student_id", student!.id)
      .order("submitted_at", { ascending: false });

    if (subsError) {
      setLoadError("The medical submission could not be loaded.");
      setLoading(false);
      return;
    }

    // Attendance rows this student can already see (own-row RLS) that were
    // auto-excused by an approved submission — used to show "N day(s)
    // marked Excused" per course instead of just an "Approved" badge.
    const { data: excusedRows } = await supabase
      .from("attendance")
      .select("course_id, excused_via_submission_id")
      .eq("student_id", student!.id)
      .not("excused_via_submission_id", "is", null);

    const excusedCountFor = (submissionId: string, courseId: string) =>
      (excusedRows ?? []).filter(
        (r: any) =>
          r.excused_via_submission_id === submissionId && r.course_id === courseId,
      ).length;

    setSubmissions(
      (subs ?? []).map((s: any) => {
        const links = s.medical_submission_courses ?? [];
        return {
          id: s.id,
          reason_type: s.reason_type,
          missed_date: s.missed_date,
          end_date: s.end_date,
          description: s.description,
          status: s.status,
          deadline: s.deadline,
          submitted_at: s.submitted_at,
          review_notes: s.review_notes,
          courses: links
            .filter((link: any) => link.courses)
            .map((link: any) => ({
              code: link.courses.course_code,
              title: link.courses.title,
              department: link.department,
              reviewStatus: link.review_status,
              reviewNotes: link.review_notes,
              excusedDays: excusedCountFor(s.id, link.course_id),
            })),
          files: s.medical_submission_files ?? [],
        };
      }),
    );
    setLoading(false);
  };

  const toggleCourse = (courseId: string) => {
    setSelectedCourseIds((prev) =>
      prev.includes(courseId)
        ? prev.filter((id) => id !== courseId)
        : [...prev, courseId],
    );
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;

    const okTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
    for (const f of picked) {
      if (f.size > 5 * 1024 * 1024) {
        setFormError(`"${f.name}" is larger than 5MB.`);
        return;
      }
      if (!okTypes.includes(f.type)) {
        setFormError(`"${f.name}" must be a PDF, JPG, or PNG file.`);
        return;
      }
    }
    setFormError(null);
    setFiles((prev) => [...prev, ...picked]);
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setReasonType("medical");
    setSelectedCourseIds([]);
    setStartDate("");
    setEndDate("");
    setDescription("");
    setFiles([]);
  };

  const handleSubmit = async () => {
    setFormError(null);
    setFormSuccess(null);

    if (!startDate) {
      setFormError("Please select the date of the event/onset.");
      return;
    }
    if (selectedCourseIds.length === 0) {
      setFormError("Please select at least one missed course.");
      return;
    }
    if (files.length === 0) {
      setFormError(
        "Please attach at least one medical certificate or supporting document.",
      );
      return;
    }
    if (!student?.id) return;

    setSubmitting(true);

    try {
      const { data: inserted, error: insertError } = await supabase
        .from("medical_submissions")
        .insert({
          student_id: student.id,
          reason_type: reasonType,
          missed_date: startDate,
          end_date: endDate || null,
          description: description || null,
          status: "pending",
        })
        .select("id")
        .single();

      if (insertError || !inserted) {
        setFormError("Submission failed. Please try again.");
        setSubmitting(false);
        return;
      }

      const submissionId = inserted.id;

      const { error: coursesError } = await supabase
        .from("medical_submission_courses")
        .insert(
          selectedCourseIds.map((courseId) => ({
            submission_id: submissionId,
            course_id: courseId,
          })),
        );

      if (coursesError) {
        setFormError("Submission failed while linking courses.");
        setSubmitting(false);
        return;
      }

      for (const file of files) {
        const ext = file.name.split(".").pop();
        const path = `${student.id}/${submissionId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("medical-certificates")
          .upload(path, file);

        if (uploadError) {
          setFormError(`Upload failed for "${file.name}". Please try again.`);
          setSubmitting(false);
          return;
        }

        const { error: fileRowError } = await supabase
          .from("medical_submission_files")
          .insert({
            submission_id: submissionId,
            file_url: path,
            file_name: file.name,
          });

        if (fileRowError) {
          setFormError(`Could not save the record for "${file.name}". Please try again.`);
          setSubmitting(false);
          return;
        }
      }

      setFormSuccess(
        "Submitted successfully. The relevant department(s) will review it shortly.",
      );
      resetForm();
      await fetchData();
    } catch {
      setFormError("Something went wrong. Please try again.");
    }

    setSubmitting(false);
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

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      approved: "bg-green-100 text-green-700",
      rejected: "bg-red-100 text-red-700",
      pending: "bg-amber-100 text-amber-800",
      partially_approved: "bg-blue-100 text-blue-700",
      mixed: "bg-purple-100 text-purple-700",
    };
    const icon =
      status === "approved" ? (
        <CheckCircle2 className="h-3 w-3 mr-1" />
      ) : status === "rejected" ? (
        <XCircle className="h-3 w-3 mr-1" />
      ) : (
        <Clock className="h-3 w-3 mr-1" />
      );
    return (
      <Badge className={styles[status] ?? "bg-muted text-muted-foreground"}>
        {icon}
        {OVERALL_STATUS_LABELS[status] ?? status}
      </Badge>
    );
  };

  const courseStatusBadge = (status: string) => {
    if (status === "approved")
      return <Badge className="bg-green-100 text-green-700 text-[10px]">Approved</Badge>;
    if (status === "rejected")
      return <Badge className="bg-red-100 text-red-700 text-[10px]">Rejected</Badge>;
    return <Badge className="bg-amber-100 text-amber-800 text-[10px]">Pending</Badge>;
  };

  const isPastDeadline = (missedDate: string, submittedAt: string) => {
    const eventDate = new Date(missedDate);
    const submitted = new Date(submittedAt);
    return daysBetween(eventDate, submitted) > 14;
  };

  // live deadline preview while filling the form
  const willBeLate =
    startDate && daysBetween(new Date(startDate), new Date()) > 14;

  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold text-foreground mb-1">
          Medical Certificates
        </h1>
        <p className="text-muted-foreground text-sm">
          Submit evidence to be excused from academic activities due to a
          medical reason or bereavement.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="p-3 rounded-xl bg-blue-50 border border-blue-200 flex gap-2.5"
      >
        <AlertTriangle className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-900">
          Per Faculty policy, evidence must be submitted within{" "}
          <strong>14 days</strong> of the event (illness onset, or the demise of
          a parent, sibling, or spouse). Acceptability of evidence is determined
          by the Faculty after review.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Submission form */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4 }}
          className="lg:col-span-2"
        >
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-lg">New Submission</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="mb-2 block">Reason</Label>
                <Select value={reasonType} onValueChange={setReasonType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(REASON_LABELS).map(([val, label]) => (
                      <SelectItem key={val} value={val}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-2 block">
                  Missed Course(s){" "}
                  <span className="text-muted-foreground font-normal">
                    — select all that apply
                  </span>
                </Label>
                {courses.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-2">
                    You have no currently enrolled courses to select from.
                  </p>
                ) : (
                  <div className="border border-border rounded-xl max-h-48 overflow-y-auto divide-y divide-border">
                    {courses.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                      >
                        <Checkbox
                          checked={selectedCourseIds.includes(c.id)}
                          onCheckedChange={() => toggleCourse(c.id)}
                        />
                        <Badge className="bg-primary/10 text-primary text-xs flex-shrink-0">
                          {c.code}
                        </Badge>
                        <span className="text-foreground truncate">
                          {c.title}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-2 block">
                    {reasonType === "bereavement"
                      ? "Date of demise"
                      : "Start date"}
                  </Label>
                  <Input
                    type="date"
                    value={startDate}
                    max={new Date().toISOString().split("T")[0]}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="mb-2 block">End date (if multi-day)</Label>
                  <Input
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>

              {willBeLate && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800">
                    This is more than 14 days after the event date. It may still
                    be submitted, but acceptance is at the Faculty's discretion.
                  </p>
                </div>
              )}

              <div>
                <Label className="mb-2 block">
                  Additional details (optional)
                </Label>
                <Textarea
                  placeholder="Briefly describe the situation..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>

              <div>
                <Label className="mb-2 block">Supporting Evidence</Label>
                <label className="flex items-center gap-3 p-3 rounded-xl border-2 border-dashed border-border hover:border-primary/50 cursor-pointer transition-colors">
                  <Upload className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-muted-foreground truncate">
                    Upload PDF, JPG, or PNG (max 5MB each) — multiple files
                    allowed
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    multiple
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </label>
                {files.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {files.map((f, i) => (
                      <div
                        key={`${f.name}-${i}`}
                        className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-muted/50 text-xs"
                      >
                        <span className="flex items-center gap-1.5 text-foreground truncate">
                          <Paperclip className="h-3 w-3 flex-shrink-0" />
                          {f.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="text-muted-foreground hover:text-destructive flex-shrink-0"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {formError && <p className="text-sm text-red-600">{formError}</p>}
              {formSuccess && (
                <p className="text-sm text-green-600">{formSuccess}</p>
              )}

              <Button
                className="w-full bg-primary hover:bg-primary/90"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit for Review"
                )}
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {/* Submission history */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4 }}
          className="lg:col-span-3"
        >
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-lg">Your Submissions</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-24 rounded-xl bg-muted animate-pulse"
                    />
                  ))}
                </div>
              ) : loadError ? (
                <div className="text-center py-12">
                  <AlertTriangle className="h-10 w-10 text-red-400 mx-auto mb-3" />
                  <p className="text-red-600 font-medium mb-3">{loadError}</p>
                  <Button size="sm" variant="outline" onClick={fetchData}>
                    Try again
                  </Button>
                </div>
              ) : submissions.length === 0 ? (
                <div className="text-center py-12">
                  <FileHeart className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    No submissions yet
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    Submit evidence using the form to request an excuse.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {submissions.map((sub) => {
                    const late = isPastDeadline(
                      sub.missed_date,
                      sub.submitted_at,
                    );
                    return (
                      <div
                        key={sub.id}
                        className="p-3 rounded-xl border border-border"
                      >
                        <div className="flex items-start justify-between mb-2 gap-2">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-foreground">
                                {REASON_LABELS[sub.reason_type] ?? "Other"}
                              </span>
                              {late && sub.status === "pending" && (
                                <Badge className="bg-orange-100 text-orange-700 text-xs">
                                  Submitted late
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {sub.missed_date}
                              {sub.end_date ? ` → ${sub.end_date}` : ""}
                            </p>
                          </div>
                          {statusBadge(sub.status)}
                        </div>

                        {sub.description && (
                          <p className="text-sm text-foreground/80 mb-2">
                            {sub.description}
                          </p>
                        )}

                        <div className="space-y-1.5 mb-2">
                          {sub.courses.map((c) => (
                            <div
                              key={c.code}
                              className="flex items-start justify-between gap-2 p-2 rounded-lg bg-muted/30 border border-border/60"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <Badge className="bg-primary/10 text-primary text-xs">
                                    {c.code}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {c.department}
                                  </span>
                                </div>
                                {c.reviewStatus === "rejected" && c.reviewNotes && (
                                  <p className="text-xs text-red-700 mt-1">
                                    <strong>Reason:</strong> {c.reviewNotes}
                                  </p>
                                )}
                                {c.reviewStatus === "approved" && (
                                  <p className="text-xs text-green-700 mt-1">
                                    {c.excusedDays > 0
                                      ? `Attendance marked Excused for ${c.excusedDays} day${c.excusedDays > 1 ? "s" : ""}.`
                                      : "Approved — attendance will be marked once lecture records exist for these dates."}
                                  </p>
                                )}
                              </div>
                              {courseStatusBadge(c.reviewStatus)}
                            </div>
                          ))}
                        </div>

                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            {sub.files.map((f) => (
                              <button
                                key={f.id}
                                onClick={() =>
                                  handleViewFile(f.id, f.file_url)
                                }
                                className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                              >
                                <Paperclip className="h-3 w-3" />
                                {f.file_name}
                              </button>
                            ))}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            Submitted{" "}
                            {new Date(sub.submitted_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
