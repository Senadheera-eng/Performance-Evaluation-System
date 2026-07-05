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

interface Submission {
  id: string;
  reason_type: string;
  missed_date: string;
  end_date: string | null;
  description: string | null;
  file_url: string | null;
  file_name: string | null;
  status: string;
  deadline: string | null;
  submitted_at: string;
  review_notes: string | null;
  course: { code: string; title: string } | null;
}

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
  const [courseId, setCourseId] = useState<string>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!student?.id) return;
    fetchData();
  }, [student?.id]);

  const fetchData = async () => {
    setLoading(true);

    const { data: enrollments } = await supabase
      .from("enrollments")
      .select("courses(id, course_code, title)")
      .eq("student_id", student!.id)
      .eq("status", "enrolled");

    setCourses(
      (enrollments ?? [])
        .map((e: any) => e.courses)
        .filter(Boolean)
        .map((c: any) => ({ id: c.id, code: c.course_code, title: c.title })),
    );

    const { data: subs } = await supabase
      .from("medical_submissions")
      .select(
        `
        id, reason_type, missed_date, end_date, description,
        file_url, file_name, status, deadline, submitted_at, review_notes,
        course:courses(code:course_code, title)
      `,
      )
      .eq("student_id", student!.id)
      .order("submitted_at", { ascending: false });

    setSubmissions((subs as any) ?? []);
    setLoading(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      setFormError("File must be smaller than 5MB.");
      return;
    }
    const okTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
    if (!okTypes.includes(f.type)) {
      setFormError("Please upload a PDF, JPG, or PNG file.");
      return;
    }
    setFormError(null);
    setFile(f);
  };

  const resetForm = () => {
    setReasonType("medical");
    setCourseId("all");
    setStartDate("");
    setEndDate("");
    setDescription("");
    setFile(null);
  };

  const handleSubmit = async () => {
    setFormError(null);
    setFormSuccess(null);

    if (!startDate) {
      setFormError("Please select the date of the event/onset.");
      return;
    }
    if (!file) {
      setFormError(
        "Please attach your medical certificate or supporting evidence.",
      );
      return;
    }
    if (!student?.id) return;

    setSubmitting(true);

    try {
      const ext = file.name.split(".").pop();
      const path = `${student.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("medical-certificates")
        .upload(path, file);

      if (uploadError) {
        setFormError("File upload failed. Please try again.");
        setSubmitting(false);
        return;
      }

      const deadline = new Date(startDate);
      deadline.setDate(deadline.getDate() + 14);

      const { error: insertError } = await supabase
        .from("medical_submissions")
        .insert({
          student_id: student.id,
          course_id: courseId === "all" ? null : courseId,
          reason_type: reasonType,
          missed_date: startDate,
          end_date: endDate || null,
          description: description || null,
          file_url: path,
          file_name: file.name,
          deadline: deadline.toISOString().split("T")[0],
          status: "pending",
        });

      if (insertError) {
        setFormError("Submission failed. Please try again.");
        setSubmitting(false);
        return;
      }

      setFormSuccess(
        "Submitted successfully. Your department will review it shortly.",
      );
      resetForm();
      await fetchData();
    } catch {
      setFormError("Something went wrong. Please try again.");
    }

    setSubmitting(false);
  };

  const handleViewFile = async (sub: Submission) => {
    if (!sub.file_url) return;
    if (signedUrls[sub.id]) {
      window.open(signedUrls[sub.id], "_blank");
      return;
    }
    const { data } = await supabase.storage
      .from("medical-certificates")
      .createSignedUrl(sub.file_url, 60 * 10);

    if (data?.signedUrl) {
      setSignedUrls((prev) => ({ ...prev, [sub.id]: data.signedUrl }));
      window.open(data.signedUrl, "_blank");
    }
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

  const isPastDeadline = (missedDate: string, submittedAt: string) => {
    const eventDate = new Date(missedDate);
    const submitted = new Date(submittedAt);
    return daysBetween(eventDate, submitted) > 14;
  };

  // live deadline preview while filling the form
  const willBeLate =
    startDate && daysBetween(new Date(startDate), new Date()) > 14;

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Medical Certificates
        </h1>
        <p className="text-muted-foreground">
          Submit evidence to be excused from academic activities due to a
          medical reason or bereavement.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="p-4 rounded-xl bg-blue-50 border border-blue-200 flex gap-3"
      >
        <AlertTriangle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-900">
          Per Faculty policy, evidence must be submitted within{" "}
          <strong>14 days</strong> of the event (illness onset, or the demise of
          a parent, sibling, or spouse). Acceptability of evidence is determined
          by the Faculty after review.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
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
                <Label className="mb-2 block">Affected Course</Label>
                <Select value={courseId} onValueChange={setCourseId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      All ongoing courses (general excuse)
                    </SelectItem>
                    {courses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code} — {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                <label className="flex items-center gap-3 p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/50 cursor-pointer transition-colors">
                  <Upload className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-muted-foreground truncate">
                    {file ? file.name : "Upload PDF, JPG, or PNG (max 5MB)"}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </label>
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
                        className="p-4 rounded-xl border border-border"
                      >
                        <div className="flex items-start justify-between mb-2 gap-2">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-foreground">
                                {REASON_LABELS[sub.reason_type] ?? "Other"}
                              </span>
                              {sub.course ? (
                                <Badge variant="outline" className="text-xs">
                                  {sub.course.code}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs">
                                  All courses
                                </Badge>
                              )}
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

                        {sub.status === "rejected" && sub.review_notes && (
                          <p className="text-xs text-red-700 bg-red-50 rounded-lg p-2 mb-2">
                            <strong>Reason:</strong> {sub.review_notes}
                          </p>
                        )}

                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => handleViewFile(sub)}
                            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                          >
                            <Paperclip className="h-3 w-3" />
                            {sub.file_name ?? "View attachment"}
                          </button>
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
