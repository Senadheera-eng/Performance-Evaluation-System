/*
  Handbook keyword search found nothing for 15 of 18 real student questions.

  search_handbook_text used websearch_to_tsquery, which ANDs every term. A
  student asks "What happens if I fail a course?" and the passage that answers
  it is headed "Repeating a Course" and never uses the words "happens", "fail"
  or "I" together — so the AND matched nothing, and the assistant's LLM tier,
  whose only handbook tool this is, was told the handbook had no answer.

  Two changes:

  1. A materialised tsvector column with a GIN index, covering the section
     heading as well as the body. The heading is often the only place the
     topic is actually named: the paragraph defining the Dean's List does not
     contain the words "Dean's List".

  2. search_handbook_hybrid, which ORs the query's lexemes instead of ANDing
     them, and — when the caller supplies an embedding — merges that ranking
     with vector similarity by reciprocal rank fusion. Vector search already
     retrieved the right passage 17 times out of 18 on its own; fusing keeps
     that while adding the exact-term matching vectors are weak at, such as a
     course code.

  search_handbook_text and search_handbook are left in place. Both still have
  callers, and this migration is about giving the LLM tier something that
  works, not about removing what the client already relies on.
*/

alter table public.handbook_chunks
  add column if not exists tsv tsvector
  generated always as (
    to_tsvector('english', coalesce(section, '') || ' ' || coalesce(content, ''))
  ) stored;

create index if not exists handbook_chunks_tsv_idx
  on public.handbook_chunks using gin (tsv);

create or replace function public.search_handbook_hybrid(
  p_query text,
  p_embedding vector(384) default null,
  p_limit integer default 3
)
returns table(
  id uuid,
  content text,
  section text,
  page integer,
  department text,
  score double precision
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with q as (
    select nullif(
             array_to_string(
               tsvector_to_array(to_tsvector('english', coalesce(p_query, ''))),
               ' | '
             ),
             ''
           ) as or_query
  ),
  text_ranked as (
    select t.id, row_number() over (order by t.rank_score desc, t.id) as rank
      from (
        select hc.id,
               ts_rank(hc.tsv, to_tsquery('english', q.or_query)) as rank_score
          from public.handbook_chunks hc, q
         where q.or_query is not null
           and hc.tsv @@ to_tsquery('english', q.or_query)
         order by rank_score desc
         limit 20
      ) t
  ),
  vec_ranked as (
    select v.id, row_number() over (order by v.distance, v.id) as rank
      from (
        select hc.id, hc.embedding <=> p_embedding as distance
          from public.handbook_chunks hc
         where p_embedding is not null
         order by distance
         limit 20
      ) v
  ),
  fused as (
    /* Reciprocal rank fusion. The constant 60 is the usual default: it keeps
       any single ranking from dominating just because it was very confident
       about its top hit. */
    select coalesce(t.id, v.id) as id,
           coalesce(1.0 / (60 + t.rank), 0) + coalesce(1.0 / (60 + v.rank), 0) as score
      from text_ranked t
      full outer join vec_ranked v on v.id = t.id
  )
  select hc.id, hc.content, hc.section, hc.page, hc.department, f.score
    from fused f
    join public.handbook_chunks hc on hc.id = f.id
   order by f.score desc, hc.page
   limit greatest(p_limit, 1);
$$;

revoke execute on function public.search_handbook_hybrid(text, vector, integer) from public, anon;
grant execute on function public.search_handbook_hybrid(text, vector, integer) to authenticated, service_role;
