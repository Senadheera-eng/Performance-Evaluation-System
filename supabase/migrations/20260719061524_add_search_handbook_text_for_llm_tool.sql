-- add_search_handbook_text_for_llm_tool
-- Applied 20260719061524
-- Exported from the live project; do not edit by hand.

-- search_handbook (vector) needs a pre-computed 384-dim embedding as input,
-- which the free client-side RAG tier already produces locally in the
-- browser. The Gemini Edge Function has no practical way to compute that
-- same embedding server-side (running the ONNX model in Deno is neither
-- simple nor reliable), so it gets a plain full-text-search variant
-- instead — same table, same shape, no embedding required. This is a
-- last-resort tool for the LLM tier only; the fast, free vector search
-- remains the first-line path for everyone.
create function public.search_handbook_text(
  p_search text,
  p_limit int default 3
)
returns table (
  content text,
  section text,
  page int,
  department text
)
language sql
stable
security definer
set search_path = public
as $$
  select hc.content, hc.section, hc.page, hc.department
  from handbook_chunks hc
  where to_tsvector('english', hc.content || ' ' || coalesce(hc.section, ''))
        @@ websearch_to_tsquery('english', p_search)
  order by ts_rank(
    to_tsvector('english', hc.content || ' ' || coalesce(hc.section, '')),
    websearch_to_tsquery('english', p_search)
  ) desc
  limit p_limit;
$$;

-- Only ever called from the Edge Function's service-role client (which
-- bypasses grants entirely) — not meant to be callable directly from the
-- browser, so no role gets explicit EXECUTE.
revoke execute on function public.search_handbook_text(text, int) from public;
