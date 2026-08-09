-- student_result_visibility_hide_ese_and_oa
-- Applied 20260808113153
-- Exported from the live project; do not edit by hand.

-- Students must not see the raw End-Semester Examination mark.
--
-- RLS is row-level: it cannot hide a column. And a column-level GRANT is
-- per-database-role, but every signed-in user here — student, lecturer,
-- admin — is `authenticated`, so a GRANT cannot separate them either.
-- A self-scoping view is therefore the only mechanism that actually works.
--
-- oa_mark is withheld alongside ese_mark, not out of caution but because
-- OA is a linear combination of the three components:
--     oa = w_mid*mid_sem + w_ca*ca + w_ese*ese
-- With mid_sem, ca and oa all visible, ese follows exactly:
--     ese = (oa - w_mid*mid_sem - w_ca*ca) / w_ese
-- Publishing OA would hand back the very number this rule exists to hide.
-- The letter grade leaks only the OA band it was derived from, which is
-- inherent to publishing grades at all.

create or replace view public.my_published_results as
select
  r.id,
  r.student_id,
  r.course_id,
  r.offering_id,
  r.academic_year,
  r.mid_sem_mark,
  r.ca_mark,
  -- r.ese_mark  -- withheld: faculty rule
  -- r.oa_mark   -- withheld: would make ese_mark solvable
  r.grade,
  r.gpv,
  r.published_at,
  c.course_code,
  c.title            as course_title,
  c.credits,
  c.semester,
  c.year             as course_year,
  c.category,
  c.minor_category,
  c.contributes_to_gpa,
  c.department       as course_department
from public.results r
join public.courses c on c.id = r.course_id
where r.student_id = auth.uid()
  and r.is_published = true;

comment on view public.my_published_results is
  'The calling student''s own published results, without ese_mark or oa_mark. '
  'Runs as owner and self-scopes on auth.uid(); it is the only result path '
  'students are granted.';

revoke all on public.my_published_results from public, anon;
grant select on public.my_published_results to authenticated;

-- Records the policy in the regulation engine so the rule is discoverable
-- next to the attendance threshold and grading scale rather than living only
-- in a view definition.
insert into public.system_settings (key, value, description, category) values (
  'student_visible_result_fields',
  '["mid_sem_mark","ca_mark","grade","gpv"]'::jsonb,
  'Result columns a student may see. ese_mark is withheld by faculty rule; oa_mark is withheld because it makes ese_mark algebraically solvable from the visible components.',
  'grading'
) on conflict (key) do update set
  value       = excluded.value,
  description = excluded.description;

-- The AI assistant's per-course lookup never filtered on publication, so a
-- student could read a draft grade out of it before the department published
-- anything. Every other student-facing path already gated on is_published;
-- this one was missed.
create or replace function public.get_student_course_result(p_search text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_student_id uuid := auth.uid();
  v_results jsonb;
  v_tokens text[];
BEGIN
  IF p_search IS NULL OR btrim(p_search) = '' THEN
    RETURN jsonb_build_object('error', 'Please provide a course code or name.');
  END IF;

  v_tokens := regexp_split_to_array(trim(p_search), '\s+');

  SELECT jsonb_agg(jsonb_build_object(
    'course_code', c.course_code,
    'title', c.title,
    'semester', c.semester,
    'credits', c.credits,
    'grade', r.grade,
    'grade_point', r.gpv
  ) ORDER BY c.semester)
  INTO v_results
  FROM results r
  JOIN courses c ON c.id = r.course_id
  WHERE r.student_id = v_student_id
    AND r.is_published = true
    AND (
      c.course_code ILIKE '%' || p_search || '%'
      OR (
        SELECT bool_and(
          CASE
            WHEN tok ~* '^[ivxlcdm]+$' AND length(tok) <= 4
              THEN c.title ~* ('\y' || tok || '\y')
            ELSE c.title ILIKE '%' || tok || '%'
          END
        )
        FROM unnest(v_tokens) AS tok
        WHERE length(tok) > 0
      )
    );

  RETURN jsonb_build_object(
    'search', p_search,
    'results', COALESCE(v_results, '[]'::jsonb)
  );
END;
$function$;

revoke execute on function public.get_student_course_result(text) from public, anon;
grant  execute on function public.get_student_course_result(text) to authenticated;
