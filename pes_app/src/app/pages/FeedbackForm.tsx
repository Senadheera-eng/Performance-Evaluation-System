import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  EyeOff,
  Eye,
  Save,
  Send,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { Switch } from "../components/ui/switch";
import { Label } from "../components/ui/label";
import { useAuth } from "../context/AuthContext";
import {
  getActiveFeedbackPeriod,
  getFeedbackForm,
  saveDraft,
  submitFeedback,
  FeedbackPeriod,
  FeedbackFormData,
  FeedbackAnswerInput,
} from "../../lib/feedbackService";

const RATING_LABELS: Record<number, string> = {
  1: "Strongly Disagree",
  2: "Disagree",
  3: "Neutral",
  4: "Agree",
  5: "Strongly Agree",
};

const MAX_TEXT_LENGTH = 1500;

export default function FeedbackForm() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { student } = useAuth();

  const [period, setPeriod] = useState<FeedbackPeriod | null>(null);
  const [form, setForm] = useState<FeedbackFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, FeedbackAnswerInput>>(
    {},
  );
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!student?.id || !courseId) return;
    fetchData();
  }, [student?.id, courseId]);

  const fetchData = async () => {
    setLoading(true);
    const activePeriod = await getActiveFeedbackPeriod();
    setPeriod(activePeriod);
    if (activePeriod && courseId) {
      const data = await getFeedbackForm(activePeriod.id, courseId);
      setForm(data);
      if (data?.submission) {
        setIsAnonymous(data.submission.is_anonymous);
        const initial: Record<string, FeedbackAnswerInput> = {};
        data.submission.answers.forEach((a) => {
          initial[a.question_id] = a;
        });
        setAnswers(initial);
      }
    }
    setLoading(false);
  };

  const isReadOnly =
    form?.submission?.status === "submitted" &&
    (!period?.allow_editing || period?.status !== "open");

  const setRating = (questionId: string, value: number) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: { question_id: questionId, rating_value: value },
    }));
  };

  const setText = (questionId: string, value: string) => {
    if (value.length > MAX_TEXT_LENGTH) return;
    setAnswers((prev) => ({
      ...prev,
      [questionId]: { question_id: questionId, text_value: value },
    }));
  };

  const buildPayload = (): FeedbackAnswerInput[] =>
    Object.values(answers).map((a) => ({
      question_id: a.question_id,
      rating_value: a.rating_value ?? null,
      text_value: a.text_value ?? null,
    }));

  const handleSubmitClick = () => {
    setError(null);
    const missing = (form?.questions ?? []).some((q) => {
      if (!q.is_required) return false;
      const answer = answers[q.id];
      if (q.question_type === "rating") return !answer?.rating_value;
      return !answer?.text_value?.trim();
    });
    if (missing) {
      setError("Please answer all required questions.");
      return;
    }
    setConfirmOpen(true);
  };

  const handleSaveDraft = async () => {
    if (!period || !courseId) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    const result = await saveDraft(
      period.id,
      courseId,
      isAnonymous,
      buildPayload(),
    );
    if (!result.ok) {
      setError(result.error);
    } else {
      setMessage("Your feedback draft has been saved.");
      await fetchData();
    }
    setSaving(false);
  };

  const handleSubmit = async () => {
    if (!period || !courseId) return;
    setConfirmOpen(false);
    setSubmitting(true);
    setError(null);
    setMessage(null);

    const result = await submitFeedback(
      period.id,
      courseId,
      isAnonymous,
      buildPayload(),
    );
    if (!result.ok) {
      setError(result.error);
    } else {
      setMessage(
        isAnonymous
          ? "Your response was submitted anonymously. Thank you for your feedback — it will help improve the course."
          : "Thank you for your feedback. Your response has been submitted successfully and will help improve the course.",
      );
      await fetchData();
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-40 rounded-lg bg-muted animate-pulse" />
        <div className="h-96 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (!period || !form?.course) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">
          This feedback form is no longer available.
        </p>
        <Button className="mt-4" onClick={() => navigate("/app/feedback")}>
          Back to Feedback
        </Button>
      </div>
    );
  }

  const { course, questions } = form;
  const ratingQuestions = questions.filter((q) => q.question_type === "rating");
  const textQuestions = questions.filter((q) => q.question_type !== "rating");

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <button
        onClick={() => navigate("/app/feedback")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Feedback
      </button>

      <Card className="border-border">
        <CardContent className="p-4">
          <h1 className="text-lg font-bold text-foreground">
            {course.course_code} — {course.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Semester {course.semester} · {course.credits} Credits ·{" "}
            {course.category}
          </p>
          <p className="text-sm text-muted-foreground">
            Department of {course.department}
            {course.lecturer_name ? ` · ${course.lecturer_name}` : ""}
          </p>
        </CardContent>
      </Card>

      {message && (
        <div className="p-3 rounded-xl bg-green-50 border border-green-200 flex items-center gap-2.5">
          <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-800 font-medium">{message}</p>
        </div>
      )}
      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200">
          <p className="text-sm text-red-800 font-medium">{error}</p>
        </div>
      )}

      {isReadOnly && (
        <div className="p-3 rounded-xl bg-muted/50 border border-border text-sm text-muted-foreground">
          This feedback period has closed. Your response is shown read-only.
        </div>
      )}

      {/* Rating questions */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Rate Your Experience</CardTitle>
          <p className="text-xs text-muted-foreground">
            1 — Strongly Disagree · 2 — Disagree · 3 — Neutral · 4 — Agree · 5
            — Strongly Agree
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {ratingQuestions.map((q) => {
            const current = answers[q.id]?.rating_value;
            return (
              <div key={q.id}>
                <p className="text-sm font-medium text-foreground mb-2">
                  {q.question_text}
                  {q.is_required && (
                    <span className="text-destructive ml-1">*</span>
                  )}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {[1, 2, 3, 4, 5].map((val) => (
                    <button
                      key={val}
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => setRating(q.id, val)}
                      title={RATING_LABELS[val]}
                      className={`w-11 h-11 rounded-full text-sm font-semibold border-2 transition-all disabled:cursor-not-allowed ${
                        current === val
                          ? "text-white shadow-md"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                      style={
                        current === val
                          ? { backgroundColor: "#C41E3A", borderColor: "#C41E3A" }
                          : {}
                      }
                    >
                      {val}
                    </button>
                  ))}
                  {current && (
                    <span className="text-xs text-muted-foreground ml-1">
                      {RATING_LABELS[current]}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Written questions */}
      {textQuestions.length > 0 && (
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base">Your Comments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {textQuestions.map((q) => {
              const value = answers[q.id]?.text_value ?? "";
              return (
                <div key={q.id}>
                  <Label className="mb-2 block text-sm font-medium">
                    {q.question_text}
                    {q.is_required && (
                      <span className="text-destructive ml-1">*</span>
                    )}
                  </Label>
                  <Textarea
                    value={value}
                    onChange={(e) => setText(q.id, e.target.value)}
                    disabled={isReadOnly}
                    rows={3}
                    placeholder="Share your thoughts..."
                  />
                  <p className="text-xs text-muted-foreground mt-1 text-right">
                    {value.length}/{MAX_TEXT_LENGTH}
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Anonymity toggle */}
      <Card className="border-border">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-2.5">
              {isAnonymous ? (
                <EyeOff className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              ) : (
                <Eye className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium text-foreground">
                  Submit anonymously
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isAnonymous
                    ? "Your identity will not be shown to department administrators, lecturers, or feedback reports."
                    : "Your name and student details may be visible to authorised faculty administrators."}
                </p>
              </div>
            </div>
            <Switch
              checked={isAnonymous}
              onCheckedChange={setIsAnonymous}
              disabled={isReadOnly}
            />
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      {!isReadOnly && (
        <div className="flex flex-col sm:flex-row gap-3 pb-6">
          <Button
            variant="outline"
            className="flex-1 h-10"
            disabled={saving || submitting}
            onClick={handleSaveDraft}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Draft
          </Button>
          <Button
            className="flex-1 h-10 bg-primary hover:bg-primary/90"
            disabled={saving || submitting}
            onClick={handleSubmitClick}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {form.submission?.status === "submitted"
              ? "Update Feedback"
              : "Submit Feedback"}
          </Button>
        </div>
      )}

      {/* Confirmation dialog (simple inline, matches existing app's modal-free pattern) */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card rounded-xl border border-border shadow-xl max-w-sm w-full p-5"
          >
            <h3 className="font-semibold text-foreground mb-2">
              Submit this feedback now?
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              You may edit it until the feedback period closes.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-primary hover:bg-primary/90"
                onClick={handleSubmit}
              >
                Confirm & Submit
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
