-- pgvector lives in the extensions schema, and every search path is pinned.
--
-- Two functions still resolved names through whatever search_path the caller
-- happened to have: academic_year_for, which decides which academic year a
-- sitting belongs to for half the enrolment and results functions, and the
-- notices updated_at trigger. A caller who can create objects earlier on the
-- path could put their own "now()" or table in front of ours. Pinned to
-- public, like every other function here.
--
-- The vector extension was installed into public, which puts its ~100
-- operator and support functions beside the application's own and exposes
-- them over /rpc. Moving it to the extensions schema is safe for the data:
-- handbook_chunks.embedding and its HNSW index refer to the type by OID, not
-- by name. What does depend on the name is the operators: the two handbook
-- search functions use <=> under search_path = public, and would no longer
-- find it. They get extensions on their path, as do the other two functions
-- whose body mentions embeddings, so nothing is left resolving by luck.

alter function public.academic_year_for(integer, integer) set search_path = public;
alter function public.notices_touch_updated_at() set search_path = public;

alter extension vector set schema extensions;

alter function public.search_handbook(extensions.vector, integer, double precision)
  set search_path = public, extensions;
alter function public.search_handbook_hybrid(text, extensions.vector, integer)
  set search_path = public, extensions;
alter function public.search_handbook_text(text, integer)
  set search_path = public, extensions;
alter function public.get_my_notices(text, text, text, integer, integer, text, boolean, boolean, text, integer, integer)
  set search_path = public, extensions;
