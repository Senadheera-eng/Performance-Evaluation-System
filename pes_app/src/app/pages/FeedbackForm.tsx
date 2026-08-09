import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  EyeOff,
  Eye,
  Save,
  Send,
  AlertCircle,
  Lock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Switch } from "../components/ui/switch";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../../lib/settings";
import { QuestionField } from "../components/feedback/QuestionField";
import {
  getActiveFeedbackPeriods,
  getFeedbackForm,
  saveDraft,
  submitFeedback,
  answerKey,
  isQuestionVisible,
  FeedbackPeriod,
  FeedbackFormData,
  FeedbackAnswerInput,
  FeedbackSection,
} from "../../lib/feedbackService";

const FORM_ERRORS: Record<string, string> = {
  period_not_found: "No feedback period is currently open.",
  not_eligible: "You are not eligible to submit feedback for this course.",
  no_questions: "No questions have been configured for this feedback form.",
};

export default function FeedbackForm() {
  const { courseId } = useParams<{ courseId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { student } = useAuth();
  const settings = useSettings();
  const maxTextLength = settings.feedbackTextMaxLength;

  const [period, setPeriod] = useState<FeedbackPeriod | null>(null);
  const [form, setForm] = useState<FeedbackFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
    loadForm();
  }, [student?.id, courseId]);

  const loadForm = async () => {
    setLoading(true);
    setLoadError(null);
    setError(null);

    const periodsResult = await getActiveFeedbackPeriods();
    if (!periodsResult.ok) {
      setLoadError(periodsResult.error);
      setLoading(false);
      return;
    }

    // Prefer the period the student came from; fall back to the first open one.
    const requestedId = searchParams.get("period");
    const active =
      periodsResult.data.find((p) => p.id === requestedId) ??
      periodsResult.data[0] ??
      null;

    if (!active) {
      setLoadError(FORM_ERRORS.period_not_found);
      setLoading(false);
      return;
    }
    setPeriod(active);

    const formResult = await getFeedbackForm(active.id, courseId!);
    if (!formResult.ok) {
      setLoadError(formResult.error);
      setLoading(false);
      return;
    }

    const data = formResult.data;
    if (data.error) {
      setLoadError(FORM_ERRORS[data.error] ?? "This form could not be loaded.");
      setForm(data);
      setLoading(false);
      return;
    }

    setForm(data);
    if (data.submission) {
      setIsAnonymous(data.submission.is_anonymous);
      const initial: Record<string, FeedbackAnswerInput> = {};
      data.submission.answers.forEach((a) => {
        initial[answerKey(a.question_id, a.lecturer_target_id)] = a;
      });
      setAnswers(initial);
    }
    setLoading(false);
  };

  const canEdit = form?.can_edit ?? false;
  const isSubmitted = form?.submission?.status === "submitted";

  /**
   * Answers are keyed by question *and* target. A lecturer-level question is
   * asked once per lecturer, so keying on the question alone would let three
   * lecturers' ratings overwrite one another.
   */
  const setAnswer = (
    questionId: string,
    lecturerTargetId: string | null,
    patch: Partial<FeedbackAnswerInput>,
  ) => {
    const key = answerKey(questionId, lecturerTargetId);
    setAnswers((prev) => ({
      ...prev,
      [key]: {
        question_id: questionId,
        lecturer_target_id: lecturerTargetId,
        ...patch,
      },
    }));
  };

  /**
   * Only what is actually on screen is sent. A question hidden behind an
   * unanswered gate must not carry a stale answer from before the gate was
   * changed — the database would accept it, and it would show up in the
   * analytics for a section the student was never asked.
   */
  const buildPayload = (): FeedbackAnswerInput[] => {
    if (!form) return [];
    const visibleKeys = new Set<string>();
    for (const section of form.sections) {
      const targets =
        section.target_type === "lecturer"
          ? form.lecturers.map((l) => l.lecturer_id)
          : [null];
      for (const target of targets) {
        for (const q of section.questions) {
          if (isQuestionVisible(q, answers, target)) {
            visibleKeys.add(answerKey(q.id, target));
          }
        }
      }
    }

    return Object.entries(answers)
      .filter(([key]) => visibleKeys.has(key))
      .map(([, a]) => ({
        question_id: a.question_id,
        lecturer_target_id: a.lecturer_target_id ?? null,
        rating_value: a.rating_value ?? null,
        text_value: a.text_value ?? null,
        choice_value: a.choice_value ?? null,
      }));
  };

  /** Required questions with nothing filled in, by the same rules the
   *  database applies — so the client never blocks a valid submission or
   *  waves through one the server will reject. */
  const missingRequired = (): number => {
    if (!form) return 0;
    let missing = 0;
    for (const section of form.sections) {
      const targets =
        section.target_type === "lecturer"
          ? form.lecturers.map((l) => l.lecturer_id)
          : [null];
      for (const target of targets) {
        for (const q of section.questions) {
          if (!q.is_required) continue;
          if (!isQuestionVisible(q, answers, target)) continue;
          const a = answers[answerKey(q.id, target)];
          const provided =
            q.question_type === "rating"
              ? a?.rating_value != null
              : q.question_type === "single_choice" || q.question_type === "yes_no"
                ? Boolean(a?.choice_value?.trim())
                : Boolean(a?.text_value?.trim());
          if (!provided) missing += 1;
        }
      }
    }
    return missing;
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
      await loadForm();
    }
    setSaving(false);
  };

  const handleSubmitClick = () => {
    setError(null);
    const missing = missingRequired();
    if (missing > 0) {
      setError(
        `Please answer all required questions — ${missing} still to go.`,
      );
      return;
    }
    setConfirmOpen(true);
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
          ? "Thank you for your feedback. Your response was submitted anonymously and will help improve the course."
          : "Thank you for your feedback. Your response has been submitted successfully and will help improve the course.",
      );
      await loadForm();
    }
    setSubmitting(false);
  };

  const backLink = (
    <button
      onClick={() => navigate("/app/feedback")}
      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Feedback
    </button>
  );

  if (loading) {
    return (
      <div className="space-y-4 max-w-3xl mx-auto">
        <div className="h-5 w-32 rounded bg-muted animate-pulse" />
        <div className="h-24 rounded-xl bg-muted animate-pulse" />
        <div className="h-96 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4 max-w-3xl mx-auto">
        {backLink}
        <Card className="border-destructive/30">
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
            <h3 className="text-base font-semibold text-foreground mb-1">
              This feedback form isn't available
            </h3>
            <p className="text-muted-foreground text-sm mb-4">{loadError}</p>
            <Button variant="outline" onClick={() => navigate("/app/feedback")}>
              Back to Feedback
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!form?.course) {
    return (
      <div className="space-y-4 max-w-3xl mx-auto">
        {backLink}
        <Card className="border-border">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground text-sm">
              This feedback form could not be loaded.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { course, lecturers } = form;
  // Course sections render once. Lecturer sections render once per lecturer
  // teaching this delivery, each with its own set of answers.
  const courseSections = form.sections.filter((s) => s.target_type === "course");
  const lecturerSections = form.sections.filter(
    (s) => s.target_type === "lecturer",
  );
  const hasRating = form.sections.some((s) =>
    s.questions.some((q) => q.question_type === "rating"),
  );

  const renderSection = (
    section: FeedbackSection,
    lecturerTargetId: string | null,
    keyPrefix: string,
  ) => {
    const visible = section.questions.filter((q) =>
      isQuestionVisible(q, answers, lecturerTargetId),
    );
    if (visible.length === 0) return null;
    return (
      <div key={`${keyPrefix}-${section.key}`} className="space-y-5">
        {visible.map((q) => (
          <QuestionField
            key={answerKey(q.id, lecturerTargetId)}
            question={q}
            answer={answers[answerKey(q.id, lecturerTargetId)]}
            disabled={!canEdit}
            maxTextLength={maxTextLength}
            onChange={(patch) => setAnswer(q.id, lecturerTargetId, patch)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {backLink}

      <Card className="border-border">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
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
            </div>
            {isSubmitted && (
              <Badge className="bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Submitted
              </Badge>
            )}
            {!isSubmitted && form.submission?.status === "draft" && (
              <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                Draft
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {message && (
        <div className="p-3 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 flex items-start gap-2.5">
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-800 dark:text-green-300 font-medium">
            {message}
          </p>
        </div>
      )}
      {error && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-300 font-medium">
            {error}
          </p>
        </div>
      )}

      {!canEdit && (
        <div className="p-3 rounded-xl bg-muted/60 border border-border flex items-start gap-2.5">
          <Lock className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            {!form.period_open
              ? "This feedback period has closed. Your response is shown read-only."
              : "Your response has been submitted and can no longer be edited."}
          </p>
        </div>
      )}

      {hasRating && (
        <p className="px-1 text-xs text-muted-foreground">
          Rating scale — 1 Strongly Disagree · 2 Disagree · 3 Neutral · 4 Agree
          · 5 Strongly Agree
        </p>
      )}

      {/* Course-level sections */}
      {courseSections.map((section) => {
        const body = renderSection(section, null, "course");
        if (!body) return null;
        return (
          <Card key={section.key} className="border-border">
            <CardHeader>
              <CardTitle className="text-base">{section.title}</CardTitle>
            </CardHeader>
            <CardContent>{body}</CardContent>
          </Card>
        );
      })}

      {/* One block per lecturer who actually taught this delivery. The names
          come from the assignment records, so nobody has to type them and
          every response can be aggregated to the right person. */}
      {lecturerSections.length > 0 &&
        (lecturers.length === 0 ? (
          <Card className="border-border">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">
                No lecturer has been assigned to this course yet, so there is
                nothing to rate in the lecturer sections. The rest of the form
                can still be submitted.
              </p>
            </CardContent>
          </Card>
        ) : (
          lecturers.map((lecturer) => (
            <Card key={lecturer.lecturer_id} className="border-border">
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{lecturer.name}</CardTitle>
                  {lecturer.assignment_role === "coordinator" && (
                    <Badge className="bg-primary/10 text-primary">
                      Course Coordinator
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Answered separately for each lecturer on this course.
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                {lecturerSections.map((section) => {
                  const body = renderSection(
                    section,
                    lecturer.lecturer_id,
                    lecturer.lecturer_id,
                  );
                  if (!body) return null;
                  return (
                    <div key={`${lecturer.lecturer_id}-${section.key}`}>
                      {lecturerSections.length > 1 && (
                        <p className="mb-3 text-sm font-semibold text-foreground">
                          {section.title}
                        </p>
                      )}
                      {body}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))
        ))}

      {/* Anonymity */}
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
              disabled={!canEdit}
              aria-label="Submit anonymously"
            />
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      {canEdit && (
        <div className="flex flex-col sm:flex-row gap-3 pb-6">
          <Button
            variant="outline"
            className="flex-1 h-10"
            disabled={saving || submitting}
            onClick={handleSaveDraft}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Draft
              </>
            )}
          </Button>
          <Button
            className="flex-1 h-10 bg-primary hover:bg-primary/90"
            disabled={saving || submitting}
            onClick={handleSubmitClick}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                {isSubmitted ? "Update Feedback" : "Submit Feedback"}
              </>
            )}
          </Button>
        </div>
      )}

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
              {form.allow_editing
                ? "You may edit it until the feedback period closes."
                : "This response cannot be edited after submission."}
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
                Confirm &amp; Submit
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
