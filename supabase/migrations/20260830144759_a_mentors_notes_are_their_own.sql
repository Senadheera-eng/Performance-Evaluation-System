-- a_mentors_notes_are_their_own
-- Applied 20260830144759
-- Exported from the live project; do not edit by hand.

-- A mentor's notes are their own.
--
-- A mentor keeps a working record about a student: what was discussed, what
-- was tried, what to follow up. Its usefulness depends entirely on being
-- private. A mentor who knows their head of department reads these writes
-- differently, and a mentor who writes differently is keeping a record of
-- what is safe to say rather than what happened. So the author is the only
-- reader -- not the head, not an admin, and not the student.
--
-- If a note needs to reach the department, the mentor sends it deliberately.
-- That is a different act from writing one down, and the system should not
-- blur them.
--
-- Notes hang off the assignment for the same reason messages do: a student
-- who moves to a new mentor does not hand over the last one's observations.
-- But the read rule is "notes I wrote about this student", not "notes on this
-- assignment" -- so a mentor who has a student, loses them, and gets them back
-- still sees everything they themselves wrote, across both assignments.

create table if not exists public.mentor_notes (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.mentor_assignments(id) on delete cascade,
  body          text not null check (btrim(body) <> ''),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

create index if not exists mentor_notes_by_assignment
  on public.mentor_notes (assignment_id, created_at desc);

comment on table public.mentor_notes is
  'Private working notes a mentor keeps about a student. Readable only by the mentor who wrote them.';

alter table public.mentor_notes enable row level security;

-- The author, and nobody else. Deliberately no policy for the head of
-- department or a super admin.
create policy mentor_notes_author_only on public.mentor_notes
  for select using (exists (
    select 1
      from public.mentor_assignments ma
      join public.lecturers l on l.id = ma.mentor_id
     where ma.id = mentor_notes.assignment_id
       and l.auth_user_id = auth.uid()));

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

-- Everything the caller has written about this student, newest first,
-- gathered across every assignment of theirs rather than only the current
-- one.
create or replace function public.get_mentor_notes(p_student_id uuid)
returns table(
  note_id uuid, body text, created_at timestamptz, updated_at timestamptz,
  assignment_id uuid, written_while_current boolean)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_lecturer uuid := public.my_lecturer_id();
begin
  if v_lecturer is null then return; end if;

  return query
  select n.id, n.body, n.created_at, n.updated_at, n.assignment_id,
         ma.ended_at is null
    from public.mentor_notes n
    join public.mentor_assignments ma on ma.id = n.assignment_id
   where ma.student_id = p_student_id
     and ma.mentor_id = v_lecturer
   order by n.created_at desc;
end;
$$;

grant execute on function public.get_mentor_notes(uuid) to authenticated;

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

-- Adds a note, or rewrites one of the caller's own. Writing needs a current
-- assignment: a mentor keeps what they wrote about a student who has moved
-- on, but does not go on adding to it.
create or replace function public.save_mentor_note(
  p_student_id uuid,
  p_body       text,
  p_note_id    uuid default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_lecturer uuid := public.my_lecturer_id();
  v_assign   uuid;
  v_id       uuid;
begin
  if v_lecturer is null then
    raise exception 'Only a lecturer keeps mentoring notes';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Write something first';
  end if;
  if length(p_body) > 8000 then
    raise exception 'That note is too long. Keep it under 8000 characters.';
  end if;

  if p_note_id is not null then
    -- Rewriting: the note must be one of the caller's own.
    update public.mentor_notes n
       set body = btrim(p_body), updated_at = now()
      from public.mentor_assignments ma
     where n.id = p_note_id
       and ma.id = n.assignment_id
       and ma.mentor_id = v_lecturer
       and ma.student_id = p_student_id
    returning n.id into v_id;

    if v_id is null then
      raise exception 'That note is not one of yours';
    end if;
    return jsonb_build_object('ok', true, 'note_id', v_id, 'message', 'Note updated.');
  end if;

  select ma.id into v_assign
    from public.mentor_assignments ma
   where ma.student_id = p_student_id
     and ma.mentor_id = v_lecturer
     and ma.ended_at is null;

  if v_assign is null then
    raise exception 'You are not this student''s mentor';
  end if;

  insert into public.mentor_notes (assignment_id, body)
  values (v_assign, btrim(p_body))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'note_id', v_id, 'message', 'Note saved.');
end;
$$;

grant execute on function public.save_mentor_note(uuid, text, uuid) to authenticated;

create or replace function public.delete_mentor_note(p_note_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_lecturer uuid := public.my_lecturer_id();
  v_n        int;
begin
  if v_lecturer is null then
    raise exception 'Only a lecturer keeps mentoring notes';
  end if;

  delete from public.mentor_notes n
   using public.mentor_assignments ma
   where n.id = p_note_id
     and ma.id = n.assignment_id
     and ma.mentor_id = v_lecturer;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    raise exception 'That note is not one of yours';
  end if;
  return jsonb_build_object('ok', true, 'message', 'Note deleted.');
end;
$$;

grant execute on function public.delete_mentor_note(uuid) to authenticated;

-- How many notes the caller holds on each of their current mentees, so the
-- list can say which students they have a record on without opening each.
create or replace function public.my_mentee_note_counts()
returns table(student_id uuid, notes integer)
language sql stable security definer set search_path to 'public'
as $$
  select ma.student_id, count(n.id)::int
    from public.mentor_assignments ma
    join public.lecturers l on l.id = ma.mentor_id
    left join public.mentor_notes n on n.assignment_id = ma.id
   where l.auth_user_id = auth.uid() and l.status = 'active'
     and ma.ended_at is null
   group by ma.student_id;
$$;

grant execute on function public.my_mentee_note_counts() to authenticated;
