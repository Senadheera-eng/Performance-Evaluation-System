-- course_feedback_system_schema
-- Applied 20260721030459
-- Exported from the live project; do not edit by hand.


-- Reuse existing courses table; add the one missing field the spec needs.
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS lecturer_name text;

CREATE TABLE public.feedback_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  academic_year text NOT NULL,
  semester int NOT NULL,
  batch_year int NULL,
  department text NULL, -- NULL = faculty-wide, managed by super_admin only
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','open','closed','archived')),
  allow_editing boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.admins(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (closes_at > opens_at)
);

CREATE TABLE public.feedback_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_text text NOT NULL,
  question_type text NOT NULL CHECK (question_type IN ('rating','short_text','long_text')),
  category text NULL,
  display_order int NOT NULL,
  is_required boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.feedback_period_questions (
  feedback_period_id uuid NOT NULL REFERENCES public.feedback_periods(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.feedback_questions(id) ON DELETE CASCADE,
  display_order int NOT NULL,
  PRIMARY KEY (feedback_period_id, question_id)
);

CREATE TABLE public.feedback_period_courses (
  feedback_period_id uuid NOT NULL REFERENCES public.feedback_periods(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  PRIMARY KEY (feedback_period_id, course_id)
);

CREATE TABLE public.feedback_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_period_id uuid NOT NULL REFERENCES public.feedback_periods(id),
  student_id uuid NOT NULL REFERENCES public.students(id),
  course_id uuid NOT NULL REFERENCES public.courses(id),
  is_anonymous boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  submitted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feedback_period_id, student_id, course_id)
);

CREATE TABLE public.feedback_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.feedback_submissions(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.feedback_questions(id),
  rating_value int NULL CHECK (rating_value IS NULL OR rating_value BETWEEN 1 AND 5),
  text_value text NULL CHECK (text_value IS NULL OR char_length(text_value) <= 1500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, question_id)
);

CREATE INDEX idx_feedback_submissions_period ON public.feedback_submissions (feedback_period_id);
CREATE INDEX idx_feedback_submissions_course ON public.feedback_submissions (course_id);
CREATE INDEX idx_feedback_submissions_student ON public.feedback_submissions (student_id);
CREATE INDEX idx_feedback_submissions_status ON public.feedback_submissions (status);
CREATE INDEX idx_feedback_answers_submission ON public.feedback_answers (submission_id);
CREATE INDEX idx_feedback_answers_question ON public.feedback_answers (question_id);
CREATE INDEX idx_feedback_period_courses_course ON public.feedback_period_courses (course_id);
CREATE INDEX idx_feedback_periods_department ON public.feedback_periods (department);
CREATE INDEX idx_feedback_periods_batch ON public.feedback_periods (batch_year);

-- Period-open validation: cannot open/schedule without the minimum required setup.
CREATE OR REPLACE FUNCTION public.validate_feedback_period_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status IN ('open','scheduled') THEN
    IF NEW.batch_year IS NULL THEN
      RAISE EXCEPTION 'Cannot open a feedback period without a batch.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM feedback_period_courses WHERE feedback_period_id = NEW.id) THEN
      RAISE EXCEPTION 'Cannot open a feedback period without any courses.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM feedback_period_questions WHERE feedback_period_id = NEW.id) THEN
      RAISE EXCEPTION 'Cannot open a feedback period without any questions.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_validate_feedback_period_transition
  BEFORE UPDATE ON public.feedback_periods
  FOR EACH ROW EXECUTE FUNCTION public.validate_feedback_period_transition();
