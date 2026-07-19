// Embeds every canonical example phrase from intent_examples.mjs and
// writes the result straight to a static JSON asset inside pes_app — no
// database involved, so there's no risk of the transcription-corruption
// problem the handbook-chunk loading hit (see pes-scripts/rag/). This file
// is small (~100 short phrases) and is committed as a regular source file;
// re-run this script whenever intent_examples.mjs changes.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pipeline } from "@huggingface/transformers";
import { INTENT_EXAMPLES } from "./intent_examples.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(
  __dirname,
  "..",
  "..",
  "pes_app",
  "src",
  "lib",
  "intentEmbeddings.json",
);

async function main() {
  const embed = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

  const entries = [];
  for (const [intent, phrases] of Object.entries(INTENT_EXAMPLES)) {
    for (const phrase of phrases) {
      const result = await embed(phrase, { pooling: "mean", normalize: true });
      entries.push({
        intent,
        phrase,
        embedding: Array.from(result.data).map((n) => Number(n.toFixed(5))),
      });
    }
    console.log(`Embedded ${phrases.length} examples for "${intent}"`);
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify({ dim: 384, entries }, null, 0));
  console.log(`Wrote ${entries.length} example embeddings to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
