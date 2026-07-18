import { supabase } from "./supabase";

/**
 * Local (in-browser) semantic search over the Faculty Handbook 2026.
 *
 * Embeddings are computed on-device with a small ONNX model via
 * transformers.js — no external API call, no per-query cost. The model
 * (~25MB) downloads once on first use and is cached by the browser.
 * Retrieval itself runs in Postgres via the `search_handbook` RPC
 * (pgvector cosine search), so the only client-side work is embedding the
 * user's question.
 */

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

export interface HandbookMatch {
  id: string;
  content: string;
  section: string | null;
  page: number | null;
  department: string | null;
  similarity: number;
}

// Lazily import + instantiate the pipeline once per session and reuse it —
// loading the model on every question would re-download/re-init needlessly.
let embedderPromise: Promise<any> | null = null;

function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = import("@xenova/transformers").then(({ pipeline }) =>
      pipeline("feature-extraction", MODEL_NAME),
    );
  }
  return embedderPromise;
}

export async function embedQuery(text: string): Promise<number[]> {
  const embed = await getEmbedder();
  const result = await embed(text, { pooling: "mean", normalize: true });
  return Array.from(result.data as Float32Array);
}

export async function searchHandbook(
  query: string,
  options: { matchCount?: number; minSimilarity?: number } = {},
): Promise<HandbookMatch[]> {
  // MiniLM cosine similarity for genuinely relevant short passages typically
  // lands ~0.3-0.45, not the 0.7+ intuition from other embedding spaces —
  // measured empirically against this corpus (see chunk_and_embed.mjs's
  // sibling test script). A higher threshold silently drops correct matches.
  const { matchCount = 3, minSimilarity = 0.3 } = options;

  const embedding = await embedQuery(query);

  const { data, error } = await supabase.rpc("search_handbook", {
    query_embedding: embedding,
    match_count: matchCount,
    min_similarity: minSimilarity,
  });

  if (error) {
    console.error("search_handbook failed:", error);
    return [];
  }

  return (data ?? []) as HandbookMatch[];
}
