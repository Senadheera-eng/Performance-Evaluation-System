-- add_handbook_rag_support
-- Applied 20260718153916
-- Exported from the live project; do not edit by hand.

-- Enable pgvector for handbook semantic search (RAG)
create extension if not exists vector;

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

-- Any authenticated user can read handbook chunks — this is shared
-- reference data (the public Faculty Handbook), not personal data.
create policy handbook_chunks_read
  on public.handbook_chunks
  for select
  using (auth.role() = 'authenticated');

-- Only dept_admin can manage the chunk set from the client; the initial
-- load is done via the Supabase management connection, which bypasses RLS.
create policy handbook_chunks_admin_all
  on public.handbook_chunks
  for all
  using (get_my_role() = 'dept_admin');

create index handbook_chunks_embedding_idx
  on public.handbook_chunks
  using hnsw (embedding vector_cosine_ops);

-- Semantic search over handbook chunks. Resolves nothing from auth.uid()
-- since handbook content isn't personal — it's the same for every caller.
create function public.search_handbook(
  query_embedding vector(384),
  match_count int default 3,
  min_similarity float default 0.5
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
