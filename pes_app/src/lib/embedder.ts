/**
 * Shared in-browser text embedding pipeline (Xenova/all-MiniLM-L6-v2 via
 * @huggingface/transformers). Both handbook retrieval (ragRetrieval.ts) and
 * intent classification (intentClassifier.ts) need to embed arbitrary text
 * the same way — this module holds the one lazily-created pipeline instance
 * so the ~25MB model is only downloaded/initialized once per session no
 * matter which feature uses it first.
 */

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

let embedderPromise: Promise<any> | null = null;

function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = import("@huggingface/transformers").then(({ pipeline }) =>
      pipeline("feature-extraction", MODEL_NAME),
    );
  }
  return embedderPromise;
}

export async function embedText(text: string): Promise<number[]> {
  const embed = await getEmbedder();
  const result = await embed(text, { pooling: "mean", normalize: true });
  return Array.from(result.data as Float32Array);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // Both vectors come out L2-normalized from the pipeline (normalize: true),
  // so dot product alone equals cosine similarity — no need to divide by
  // magnitudes here, but doing it anyway keeps this correct even if a
  // caller passes in a non-normalized vector from elsewhere.
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) na += a[i] * a[i];
  for (let i = 0; i < b.length; i++) nb += b[i] * b[i];
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
