-- A repeated course has a published row per attempt. Both are the student's
-- record and both are returned, but an answer that quotes the replaced grade
-- as "your grade" is wrong, so each row now says which attempt it is.
--
-- The GPA arithmetic in these functions already filters on the grade point,
-- which a superseded attempt no longer carries, so the averages were right
-- before this change and are unaffected by it.

create or replace function public.get_student_results(
  p_semester integer default null,
  p_course_search text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid := auth.uid();
  v_results jsonb;
  v_total_credits numeric := 0;
  v_total_weighted numeric := 0;
  v_gpa numeric;
  v_tokens text[];
begin
  if p_semester is not null and (p_semester < 1 or p_semester > 8) then
    return jsonb_build_object('error', 'Semester must be between 1 and 8.');
  end if;

  v_tokens := case when p_course_search is not null and btrim(p_course_search) <> ''
    then regexp_split_to_array(trim(p_course_search), '\s+')
    else null end;

  with attempt as (
    select r.grade, r.gpv, r.academic_year,
           c.course_code, c.title, c.semester, c.credits, c.contributes_to_gpa,
           row_number() over (partition by r.course_id
                              order by r.academic_year,
                                       r.published_at nulls first) as attempt_number,
           count(*) over (partition by r.course_id) > 1 as has_repeat,
           row_number() over (partition by r.course_id
                              order by r.academic_year desc,
                                       r.published_at desc nulls last) = 1
             as is_latest_attempt
      from results r
      join courses c on c.id = r.course_id
     where r.student_id = v_student_id
       and r.is_published
  )
  select jsonb_agg(jsonb_build_object(
           'course_code', a.course_code,
           'title', a.title,
           'semester', a.semester,
           'credits', a.credits,
           'grade', a.grade,
           'grade_point', a.gpv,
           'contributes_to_gpa', a.contributes_to_gpa,
           'academic_year', a.academic_year,
           'attempt', case when a.has_repeat then
             'attempt ' || a.attempt_number ||
             case when a.is_latest_attempt
                  then ' — this is the grade that stands'
                  else ' — replaced by a later attempt, carries no grade point' end
           end)
           order by a.semester, a.course_code, a.attempt_number)
    into v_results
    from attempt a
   where (p_semester is null or a.semester = p_semester)
     and (v_tokens is null
       or a.course_code ilike '%' || p_course_search || '%'
       or (select bool_and(
             case when tok ~* '^[ivxlcdm]+$' and length(tok) <= 4
                  then a.title ~* ('\y' || tok || '\y')
                  else a.title ilike '%' || tok || '%' end)
             from unnest(v_tokens) as tok where length(tok) > 0));

  select coalesce(sum(c.credits), 0),
         coalesce(sum(c.credits * r.gpv), 0)
    into v_total_credits, v_total_weighted
    from results r
    join courses c on c.id = r.course_id
   where r.student_id = v_student_id
     and r.is_published
     and r.gpv is not null
     and c.contributes_to_gpa
     and (p_semester is null or c.semester = p_semester)
     and (v_tokens is null
       or c.course_code ilike '%' || p_course_search || '%'
       or (select bool_and(
             case when tok ~* '^[ivxlcdm]+$' and length(tok) <= 4
                  then c.title ~* ('\y' || tok || '\y')
                  else c.title ilike '%' || tok || '%' end)
             from unnest(v_tokens) as tok where length(tok) > 0));

  if v_total_credits > 0 then
    v_gpa := round((v_total_weighted / v_total_credits)::numeric, 2);
  end if;

  return jsonb_build_object(
    'semester', p_semester,
    'course_search', p_course_search,
    'results', coalesce(v_results, '[]'::jsonb),
    'gpa', v_gpa,
    'gpa_credits', v_total_credits);
end;
$$;


create or replace function public.get_student_course_result(p_search text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid := auth.uid();
  v_results jsonb;
  v_tokens text[];
begin
  if p_search is null or btrim(p_search) = '' then
    return jsonb_build_object('error', 'Please provide a course code or name.');
  end if;

  v_tokens := regexp_split_to_array(trim(p_search), '\s+');

  with attempt as (
    select r.grade, r.gpv, r.academic_year,
           c.course_code, c.title, c.semester, c.credits,
           row_number() over (partition by r.course_id
                              order by r.academic_year,
                                       r.published_at nulls first) as attempt_number,
           count(*) over (partition by r.course_id) > 1 as has_repeat,
           row_number() over (partition by r.course_id
                              order by r.academic_year desc,
                                       r.published_at desc nulls last) = 1
             as is_latest_attempt
      from results r
      join courses c on c.id = r.course_id
     where r.student_id = v_student_id
       and r.is_published
  )
  select jsonb_agg(jsonb_build_object(
           'course_code', a.course_code,
           'title', a.title,
           'semester', a.semester,
           'credits', a.credits,
           'grade', a.grade,
           'grade_point', a.gpv,
           'academic_year', a.academic_year,
           'attempt', case when a.has_repeat then
             'attempt ' || a.attempt_number ||
             case when a.is_latest_attempt
                  then ' — this is the grade that stands'
                  else ' — replaced by a later attempt, carries no grade point' end
           end)
           order by a.semester, a.attempt_number)
    into v_results
    from attempt a
   where a.course_code ilike '%' || p_search || '%'
      or (select bool_and(
            case when tok ~* '^[ivxlcdm]+$' and length(tok) <= 4
                 then a.title ~* ('\y' || tok || '\y')
                 else a.title ilike '%' || tok || '%' end)
            from unnest(v_tokens) as tok where length(tok) > 0);

  return jsonb_build_object(
    'search', p_search,
    'results', coalesce(v_results, '[]'::jsonb));
end;
$$;;
