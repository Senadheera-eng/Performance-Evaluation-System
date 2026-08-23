-- signing_the_register_by_typing_the_code
-- Applied 20260823085557
-- Exported from the live project; do not edit by hand.

-- The six digits beside the QR have to lead somewhere. A camera that will not
-- focus, a cracked lens, a phone borrowed for the lecture -- none of those is
-- a reason to send the student to the lecturer.
--
-- The code names no session, so this searches the registers the student could
-- sign right now and takes the one whose code matches. Two open registers
-- sharing a code in the same half-minute is not worth guarding against: the
-- codes are HMAC-derived per session, and a collision would still have to
-- land on a course the same student is enrolled in.

create or replace function public.check_in_with_code(
  p_code        text,
  p_device_hash text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  s        record;
  v_win    bigint;
  v_code   text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  v_found  uuid;
  v_window bigint;
begin
  if length(v_code) <> 6 then
    return jsonb_build_object('ok', false, 'reason', 'unreadable',
      'message', 'Enter the six digits shown beside the code.');
  end if;

  if not exists (select 1 from public.students st where st.id = auth.uid()) then
    raise exception 'Only a student can sign a register';
  end if;

  v_win := floor(extract(epoch from now()) / 30)::bigint;

  -- Only registers this student could actually sign, and only the current
  -- half-minute or the one before it.
  for s in
    select ses.id, ses.secret, ses.rotate_seconds
      from public.attendance_sessions ses
      join public.course_offerings o on o.id = ses.offering_id
     where ses.status = 'open'
       and now() between ses.opens_at and ses.closes_at
       and exists (select 1 from public.enrollments e
                    where e.student_id = auth.uid()
                      and e.course_id = o.course_id
                      and e.status = 'enrolled')
  loop
    if public.attendance_window_code(s.id, s.secret, v_win) = v_code then
      v_found := s.id; v_window := v_win; exit;
    elsif public.attendance_window_code(s.id, s.secret, v_win - 1) = v_code then
      v_found := s.id; v_window := v_win - 1; exit;
    end if;
  end loop;

  if v_found is null then
    return jsonb_build_object('ok', false, 'reason', 'expired',
      'message', 'That code is not valid right now. Check the screen and try the current one.');
  end if;

  -- Hand over to the one place that decides, so both doors enforce the same
  -- rules -- enrolment, one row per student, one student per device.
  return public.check_in_to_lecture(
    v_found::text || '.' ||
      (floor(extract(epoch from now())
             / (select rotate_seconds from public.attendance_sessions where id = v_found)))::bigint::text
      || '.' ||
      left(public.attendance_window_signature(
        v_found,
        (select secret from public.attendance_sessions where id = v_found),
        floor(extract(epoch from now())
              / (select rotate_seconds from public.attendance_sessions where id = v_found))::bigint), 16),
    p_device_hash);
end;
$$;

grant execute on function public.check_in_with_code(text, text) to authenticated;
