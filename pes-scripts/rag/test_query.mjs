// Embeds a test question exactly like the browser will and prints the
// vector as a SQL-ready literal, so it can be passed straight into
// search_handbook() for a real end-to-end quality check.
import { pipeline } from "@xenova/transformers";

const question = process.argv[2];
if (!question) {
  console.error("Usage: node test_query.mjs \"your question\"");
  process.exit(1);
}

const embed = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
const result = await embed(question, { pooling: "mean", normalize: true });
const vector = Array.from(result.data);
console.log("[" + vector.map((n) => n.toFixed(4)).join(",") + "]");
