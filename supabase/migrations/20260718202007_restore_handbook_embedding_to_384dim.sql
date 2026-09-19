-- restore_handbook_embedding_to_384dim
-- Applied 20260718202007
-- Exported from the live project; do not edit by hand.

-- Reverting the earlier 64-dim block-mean-pooling experiment: it measurably
-- hurt ranking quality (a correct match tested behind an irrelevant one).
-- Back to full 384-dim MiniLM embeddings; corpus size was curated down
-- instead (dropped staff directories / clubs / front-matter) to keep the
-- data volume manageable.

drop function if exists public.search_handbook(vector, int, float);
drop table if exists public.handbook_chunks;

create table public.handbook_chunks (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  section text,
  page int,
  department text,
  embedding vector(384),
  created_at timestamptz default now()
);

alter table public.handbook_chunks enable row level security;

create policy handbook_chunks_read
  on public.handbook_chunks
  for select
  using (auth.role() = 'authenticated');

create policy handbook_chunks_admin_all
  on public.handbook_chunks
  for all
  using (get_my_role() = 'dept_admin');

create index handbook_chunks_embedding_idx
  on public.handbook_chunks
  using hnsw (embedding vector_cosine_ops);

create function public.search_handbook(
  query_embedding vector(384),
  match_count int default 3,
  min_similarity float default 0.3
)
returns table (
  id uuid,
  content text,
  section text,
  page int,
  department text,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    hc.id,
    hc.content,
    hc.section,
    hc.page,
    hc.department,
    1 - (hc.embedding <=> query_embedding) as similarity
  from handbook_chunks hc
  where 1 - (hc.embedding <=> query_embedding) >= min_similarity
  order by hc.embedding <=> query_embedding
  limit match_count;
$$;

revoke execute on function public.search_handbook(vector, int, float) from anon;
grant execute on function public.search_handbook(vector, int, float) to authenticated;
