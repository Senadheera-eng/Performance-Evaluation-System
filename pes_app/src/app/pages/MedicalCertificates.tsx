import { useState, useEffect } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileHeart,
  Info,
  Loader2,
  Paperclip,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { Checkbox } from "../components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { cn } from "../components/ui/utils";
import {
  CourseCode,
  DepartmentBadge,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SkeletonRows,
  StatusBadge,
  type StatusTone,
} from "../components/common";
import { supabase } from "../../lib/supabase";
import { departmentByCourseCode } from "../../lib/departments";
import {
  getCurrentTermAttendance,
  termLabel,
  type Term,
} from "../../lib/studentAttendance";
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

/* Pending is "with the department", not a warning; a partial or mixed
   decision is, since some of the courses were not excused. */
const OVERALL_STATUS_TONE: Record<string, StatusTone> = {
  pending: "info",
  partially_approved: "warning",
  approved: "success",
  rejected: "danger",
  mixed: "warning",
};

const COURSE_STATUS: Record<
  SubmissionCourseStatus["reviewStatus"],
  { label: string; tone: StatusTone }
> = {
  pending: { label: "Pending", tone: "info" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
};

/** "13 Jul 2026" from a date or timestamp string. */
const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });


const daysBetween = (a: Date, b: Date) =>
  Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));

export default function MedicalCertificates() {
  const { student } = useAuth();

  const [courses, setCourses] = useState<EnrolledCourse[]>([]);
  const [term, setTerm] = useState<Term | null>(null);
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

    /* The courses of the term being taught now: the same list the
       Attendance page shows, and for the same reason. A certificate excuses
       lectures, so the courses it can name are the ones with a register this
       term: enrolled on, marked in, or (for a semester recorded only as
       results) graded in. Enrolment status alone missed the latter two and,
       since an enrolment is never moved on from "enrolled", would keep old
       terms too. */
    const current = await getCurrentTermAttendance();
    if (!current.ok) {
      setLoadError("The medical submission could not be loaded.");
      setLoading(false);
      return;
    }
    setTerm(current.data.term);
    setCourses(
      current.data.deliveries
        .filter((d) => d.is_latest_attempt)
        .map((d) => ({ id: d.course_id, code: d.course_code, title: d.title }))
        .sort((a, b) => a.code.localeCompare(b.code)),
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
      <PageHeader
        title="Medical Certificates"
        description="Submit evidence to be excused from lectures missed through illness or bereavement. Each course you name is reviewed by its own department."
      />

      <div className="flex gap-2.5 rounded-xl border border-info-border bg-info-bg p-3">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-info-fg" aria-hidden="true" />
        <p className="text-sm text-foreground">
          Per Faculty policy, evidence must be submitted within{" "}
          <strong>14 days</strong> of the event (illness onset, or the demise of
          a parent, sibling, or spouse). Acceptability of evidence is determined
          by the Faculty after review.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
        {/* Submission form */}
        <SectionCard
          title="New submission"
          description={
            term
              ? `For your ${termLabel(term)} courses.`
              : "For the courses you are taking this semester."
          }
          className="lg:col-span-2"
          bodyClassName="space-y-4"
        >
          <div>
            <Label htmlFor="medical-reason" className="mb-2 block">
              Reason
            </Label>
            <Select value={reasonType} onValueChange={setReasonType}>
              <SelectTrigger id="medical-reason">
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

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-foreground">
              Missed course(s){" "}
              <span className="font-normal text-muted-foreground">
                — select all that apply
              </span>
            </legend>
            {loading ? (
              <SkeletonRows count={3} height="h-9" />
            ) : courses.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                You have no courses this semester to select. Courses appear
                here once you are enrolled on them or a lecture of theirs is
                marked.
              </p>
            ) : (
              <div className="max-h-56 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                {courses.map((c) => {
                  const dept = departmentByCourseCode(c.code);
                  const chosen = selectedCourseIds.includes(c.id);
                  return (
                  <label
                    key={c.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 border-l-4 px-3 py-2 text-sm transition-colors",
                      // The department's stripe always; its full tint once
                      // ticked, so what is chosen reads at a glance.
                      dept?.stripeClass ?? "border-l-transparent",
                      chosen
                        ? (dept?.softClass ?? "bg-muted")
                        : "hover:bg-muted/50",
                    )}
                  >
                    <Checkbox
                      checked={selectedCourseIds.includes(c.id)}
                      onCheckedChange={() => toggleCourse(c.id)}
                    />
                    <CourseCode code={c.code} className="text-xs" />
                    <span className="truncate text-foreground">{c.title}</span>
                  </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="medical-start" className="mb-2 block">
                {reasonType === "bereavement" ? "Date of demise" : "Start date"}
              </Label>
              <Input
                id="medical-start"
                type="date"
                value={startDate}
                max={new Date().toISOString().split("T")[0]}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="medical-end" className="mb-2 block">
                End date{" "}
                <span className="font-normal text-muted-foreground">
                  (if multi-day)
                </span>
              </Label>
              <Input
                id="medical-end"
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {willBeLate && (
            <div className="flex gap-2 rounded-lg border border-warning-border bg-warning-bg p-3">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning-fg"
                aria-hidden="true"
              />
              <p className="text-xs text-foreground">
                This is more than 14 days after the event date. It may still be
                submitted, but acceptance is at the Faculty's discretion.
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="medical-details" className="mb-2 block">
              Additional details{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="medical-details"
              placeholder="Briefly describe the situation..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-foreground">
              Supporting evidence
            </p>
            {/* The input is visually hidden but still focusable, so the drop
                zone can be reached and opened from the keyboard. */}
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-border p-3 transition-colors hover:border-primary/50 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
              <Upload className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm text-muted-foreground">
                Upload PDF, JPG, or PNG (max 5MB each) — multiple files allowed
              </span>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                multiple
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-1.5 text-xs"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                      <Paperclip className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                      <span className="truncate">{f.name}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label={`Remove ${f.name}`}
                      className="flex-shrink-0 rounded text-muted-foreground hover:text-danger-fg"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {formError && (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-danger-fg">
              <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              {formError}
            </p>
          )}
          {formSuccess && (
            <p role="status" className="flex items-start gap-1.5 text-sm text-success-fg">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              {formSuccess}
            </p>
          )}

          <Button className="w-full" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit for review"
            )}
          </Button>
        </SectionCard>

        {/* Submission history */}
        <SectionCard
          title="Your submissions"
          description="Newest first. Each course shows its own department's decision."
          className="lg:col-span-3"
        >
          {loading ? (
            <SkeletonRows count={3} height="h-24" />
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={fetchData} size="inline" />
          ) : submissions.length === 0 ? (
            <EmptyState
              icon={FileHeart}
              title="No submissions yet"
              description="Use the form to submit evidence for lectures you missed."
              size="inline"
            />
          ) : (
            <ul className="space-y-3">
              {submissions.map((sub) => {
                const late = isPastDeadline(sub.missed_date, sub.submitted_at);
                const tone = OVERALL_STATUS_TONE[sub.status] ?? "neutral";
                return (
                  <li key={sub.id} className="rounded-xl border border-border p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-foreground">
                            {REASON_LABELS[sub.reason_type] ?? "Other"}
                          </span>
                          {late && sub.status === "pending" && (
                            <StatusBadge tone="warning" icon={AlertTriangle}>
                              Submitted late
                            </StatusBadge>
                          )}
                        </div>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {formatDate(sub.missed_date)}
                          {sub.end_date ? ` – ${formatDate(sub.end_date)}` : ""}
                        </p>
                      </div>
                      <StatusBadge
                        tone={tone}
                        icon={
                          sub.status === "approved"
                            ? CheckCircle2
                            : sub.status === "rejected"
                              ? XCircle
                              : Clock
                        }
                      >
                        {OVERALL_STATUS_LABELS[sub.status] ?? sub.status}
                      </StatusBadge>
                    </div>

                    {sub.description && (
                      <p className="mb-2 text-sm text-foreground/80">{sub.description}</p>
                    )}

                    <ul className="mb-2 space-y-1.5">
                      {sub.courses.map((c) => (
                        <li
                          key={c.code}
                          className={cn(
                            "flex items-start justify-between gap-2 rounded-lg border border-l-4 border-border/60 bg-muted/30 p-2",
                            departmentByCourseCode(c.code)?.stripeClass,
                            departmentByCourseCode(c.code)?.washClass,
                          )}
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <CourseCode code={c.code} className="text-xs" />
                              <span className="truncate text-xs text-foreground">
                                {c.title}
                              </span>
                            </div>
                            {c.reviewStatus === "rejected" && c.reviewNotes && (
                              <p className="mt-1 text-xs text-danger-fg">
                                <strong>Reason:</strong> {c.reviewNotes}
                              </p>
                            )}
                            {c.reviewStatus === "approved" && (
                              <p className="mt-1 text-xs text-success-fg">
                                {c.excusedDays > 0
                                  ? `Attendance marked Excused for ${c.excusedDays} day${c.excusedDays > 1 ? "s" : ""}.`
                                  : "Approved — attendance will be marked once lecture records exist for these dates."}
                              </p>
                            )}
                            {c.reviewStatus === "pending" && c.department && (
                              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                With
                                <DepartmentBadge department={c.department} />
                              </p>
                            )}
                          </div>
                          <StatusBadge tone={COURSE_STATUS[c.reviewStatus].tone} dot>
                            {COURSE_STATUS[c.reviewStatus].label}
                          </StatusBadge>
                        </li>
                      ))}
                    </ul>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-3">
                        {sub.files.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => handleViewFile(f.id, f.file_url)}
                            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                          >
                            <Paperclip className="h-3 w-3" aria-hidden="true" />
                            {f.file_name}
                          </button>
                        ))}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Submitted {formatDate(sub.submitted_at)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
