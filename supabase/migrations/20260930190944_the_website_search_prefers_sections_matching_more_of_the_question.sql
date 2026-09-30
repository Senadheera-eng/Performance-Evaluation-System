-- The faculty-website search ranks first by how many of the question's
-- words a section contains, then by ts_rank_cd. Rank alone preferred a
-- section that repeats one common word: for "academic calendar batch 09
-- exams" it returned the calendar blocks that say "Batch" twice over the one
-- that is Batch 09's. The score is the count of words matched plus the rank
-- squeezed below 1, so the count decides and the rank breaks ties.
create or replace function public.search_faculty_site(
  p_query text,
  p_limit integer default 4
)
returns table (url text, title text, section text, content text, score real)
language sql
stable
security definer
set search_path to 'public'
as $$
  with q as (
    select tsvector_to_array(to_tsvector('english', coalesce(p_query, ''))) as lexemes
  ),
  tq as (
    select q.lexemes,
           to_tsquery('simple', array_to_string(q.lexemes, ' | ')) as query
      from q
     where cardinality(q.lexemes) > 0
  ),
  ranked as (
    select c.url, c.title, c.section, c.content, c.chunk_index,
           (select count(*) from unnest(tsvector_to_array(c.tsv)) t where t = any(tq.lexemes))
             as matched,
           ts_rank_cd(c.tsv, tq.query) as rank
      from public.faculty_site_chunks c, tq
     where c.tsv @@ tq.query
  ),
  per_page as (
    select r.*,
           row_number() over (partition by r.url order by r.matched desc, r.rank desc, r.chunk_index) as n
      from ranked r
  )
  select p.url, p.title, p.section, p.content,
         (p.matched + p.rank / (1 + p.rank))::real as score
    from per_page p
   where p.n <= 2
   order by p.matched desc, p.rank desc, p.url, p.chunk_index
   limit greatest(1, least(coalesce(p_limit, 4), 10))
$$;
