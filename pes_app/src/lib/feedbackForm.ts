import { supabase } from "./supabase";
import type { FeedbackOption, FeedbackQuestionType } from "./feedbackService";

/**
 * The form a lecturer shapes for their own course, before the round opens.
 *
 * The department writes the questions every course in a round is asked; a
 * lecturer adds the ones that only make sense for theirs. Both arrive here in
 * one shape so the editor can show the whole form in the order a student will
 * meet it, with the department's part fixed and the course's part editable.
 *
 * Who may edit what is the database's decision, not this file's: it refuses a
 * course the caller does not teach, and refuses any change once the round is
 * no longer a draft.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(where: string, error: { message?: string } | null): { ok: false; error: string } {
  console.error(`[feedback form] ${where}`, error);
  return {
    ok: false,
    error: error?.message ?? "Something went wrong. Please try again.",
  };
}

export interface EditorQuestion {
  id: string;
  question_text: string;
  question_type: FeedbackQuestionType;
  options: FeedbackOption[] | null;
  placeholder: string | null;
  is_required: boolean;
  target_type: "course" | "lecturer";
  display_order: number;
  /** This course added it, rather than the department. */
  mine: boolean;
  /** The viewer may change it: their own course's question, or one of the
   *  department's while they are the ones who own the round. */
  can_edit: boolean;
}

export interface EditorSection {
  section_key: string;
  title: string;
  description: string | null;
  icon: string | null;
  section_order: number;
  target_type: "course" | "lecturer";
  /** Every question in it belongs to this course. */
  mine: boolean;
  /** The viewer may rename it, describe it and change its questions. */
  can_edit: boolean;
  questions: EditorQuestion[];
}

export interface CourseFormEditor {
  period_id: string;
  period_title: string;
  period_status: "draft" | "scheduled" | "open" | "closed" | "archived";
  feedback_type: "mid_semester" | "end_semester";
  semester: number | null;
  batch_year: number | null;
  academic_year: string | null;
  opens_at: string | null;
  closes_at: string | null;
  course_id: string;
  course_code: string;
  course_title: string;
  /** The round is still a draft, so the form can change at all. */
  can_edit: boolean;
  /** The viewer owns the round's shared questions — the department's admin,
   *  a super admin, or the sitting head. A lecturer does not, because those
   *  questions are asked of every course in the round. */
  manages_round: boolean;
  sections: EditorSection[];
}

export async function getCourseFormEditor(
  periodId: string,
  courseId: string,
): Promise<Result<CourseFormEditor>> {
  const { data, error } = await supabase.rpc("get_course_form_editor", {
    p_period_id: periodId,
    p_course_id: courseId,
  });
  if (error) return fail("get_course_form_editor", error);
  return { ok: true, data: data as CourseFormEditor };
}

export interface QuestionDraft {
  /** Null adds a new question; an id edits that one. */
  questionId: string | null;
  questionText: string;
  questionType: FeedbackQuestionType;
  options: FeedbackOption[] | null;
  placeholder: string | null;
  isRequired: boolean;
  sectionTitle: string;
  sectionOrder: number;
  displayOrder: number;
}

export async function saveCourseFormQuestion(
  periodId: string,
  courseId: string,
  draft: QuestionDraft,
): Promise<Result<string>> {
  const { data, error } = await supabase.rpc("save_course_form_question", {
    p_period_id: periodId,
    p_course_id: courseId,
    p_question_id: draft.questionId,
    p_question_text: draft.questionText,
    p_question_type: draft.questionType,
    p_options: draft.options,
    p_placeholder: draft.placeholder,
    p_is_required: draft.isRequired,
    p_section_title: draft.sectionTitle,
    p_section_order: draft.sectionOrder,
    p_display_order: draft.displayOrder,
  });
  if (error) return fail("save_course_form_question", error);
  return { ok: true, data: (data as { message?: string })?.message ?? "Saved." };
}

export async function deleteCourseFormQuestion(
  periodId: string,
  courseId: string,
  questionId: string,
): Promise<Result<string>> {
  const { data, error } = await supabase.rpc("remove_course_feedback_question", {
    p_period_id: periodId,
    p_course_id: courseId,
    p_question_id: questionId,
  });
  if (error) return fail("remove_course_feedback_question", error);
  return { ok: true, data: (data as { message?: string })?.message ?? "Removed." };
}

/** Rename a section, or give it a description. */
export async function saveFormSection(
  periodId: string,
  courseId: string,
  sectionKey: string,
  title: string,
  description: string | null,
): Promise<Result<string>> {
  const { data, error } = await supabase.rpc("save_form_section", {
    p_period_id: periodId,
    p_course_id: courseId,
    p_section_key: sectionKey,
    p_title: title,
    p_description: description,
  });
  if (error) return fail("save_form_section", error);
  return { ok: true, data: (data as { message?: string })?.message ?? "Section saved." };
}
