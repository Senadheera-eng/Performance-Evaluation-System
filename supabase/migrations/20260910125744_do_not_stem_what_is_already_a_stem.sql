/*
  search_handbook_hybrid stemmed its own query twice.

  The lexemes are taken from to_tsvector('english', ...), so they arrive
  already stemmed: "degree" is "degre" by that point. Feeding them back into
  to_tsquery('english', ...) stemmed them a second time, and "degre" became
  "degr", which matches nothing — the stored vectors hold "degre".

  Twenty-five chunks contain the word degree and the query for it returned
  none of them. The vector half of the fusion hid this in testing: the
  combined ranking still looked right, so only the no-embedding path — which
  is exactly the path the edge function uses — was actually wrong.

  'simple' passes the lexemes through untouched, which is what a
  already-stemmed term needs.
*/

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
               ts_rank(hc.tsv, to_tsquery('simple', q.or_query)) as rank_score
          from public.handbook_chunks hc, q
         where q.or_query is not null
           and hc.tsv @@ to_tsquery('simple', q.or_query)
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
