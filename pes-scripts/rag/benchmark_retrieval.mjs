// Measures handbook retrieval quality against a fixed set of questions a
// student would actually type.
//
// Run it before and after any change to the chunks or the search function —
// the point is the comparison, not the absolute numbers. Each question
// carries the section its answer genuinely lives in, so "did we retrieve the
// right thing" is checked rather than "did we retrieve anything".
//
// Usage:
//   cd pes-scripts/rag
//   node benchmark_retrieval.mjs [label]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", "..", "pes_app", ".env.local");

function readEnv(key) {
  const env = readFileSync(ENV_PATH, "utf-8");
  const m = env.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : null;
}

const supabase = createClient(
  readEnv("VITE_SUPABASE_URL"),
  process.env.SUPABASE_SERVICE_ROLE_KEY || readEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/* `expect` is a case-insensitive substring matched against the retrieved
   section or content — the marker that the right passage came back. */
const QUESTIONS = [
  { q: "What courses do I need for the Data Management minor?", expect: "minor" },
  { q: "How do I get a minor in my degree?", expect: "minor" },
  { q: "What happens if I fail a course?", expect: "repeat" },
  { q: "Can I re-sit an exam I failed?", expect: "re-sit" },
  { q: "What is the highest grade I can get on a re-sit?", expect: "re-sit" },
  { q: "How is GPA calculated?", expect: "grade point average" },
  { q: "What CGPA do I need for First Class honours?", expect: "honours" },
  { q: "How many credits do I need to graduate?", expect: "award of the degree" },
  { q: "What is the Dean's List?", expect: "dean" },
  { q: "How long do I have to finish my degree?", expect: "award of the degree" },
  { q: "What is industrial training and how many credits is it?", expect: "industrial training" },
  { q: "What is continuous assessment?", expect: "continuous assessment" },
  { q: "How is the overall assessment mark worked out?", expect: "overall assessment" },
  { q: "What do I need to be allowed to sit the end of semester exam?", expect: "end of semester" },
  { q: "Can I get an academic concession for medical reasons?", expect: "concession" },
  { q: "What are the progression requirements between years?", expect: "progression" },
  { q: "How many credits is one course worth?", expect: "credit" },
  { q: "What fields of specialization can I choose?", expect: "specializ" },
];

async function embed(text) {
  const { pipeline } = await import("@huggingface/transformers");
  if (!embed._p) embed._p = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  const r = await embed._p(text, { pooling: "mean", normalize: true });
  return Array.from(r.data);
}

const hit = (rows, expect) =>
  rows.some((r) =>
    `${r.section ?? ""} ${r.content ?? ""}`.toLowerCase().includes(expect.toLowerCase()),
  );

async function main() {
  const label = process.argv[2] ?? "run";
  const results = [];

  for (const { q, expect } of QUESTIONS) {
    const vec = await embed(q);

    const { data: vRows } = await supabase.rpc("search_handbook", {
      query_embedding: vec,
      match_count: 3,
      min_similarity: 0.3,
    });
    const { data: tRows } = await supabase.rpc("search_handbook_text", {
      p_search: q,
      p_limit: 3,
    });

    let hRows = null;
    const hybrid = await supabase.rpc("search_handbook_hybrid", {
      p_query: q,
      p_embedding: vec,
      p_limit: 3,
    });
    if (!hybrid.error) hRows = hybrid.data;

    results.push({
      q,
      expect,
      vector: { n: (vRows ?? []).length, hit: hit(vRows ?? [], expect) },
      text: { n: (tRows ?? []).length, hit: hit(tRows ?? [], expect) },
      hybrid: hRows ? { n: hRows.length, hit: hit(hRows, expect) } : null,
    });
  }

  const tally = (k) => results.filter((r) => r[k] && r[k].hit).length;
  const empty = (k) => results.filter((r) => r[k] && r[k].n === 0).length;

  console.log(`\n=== ${label} — ${QUESTIONS.length} questions ===\n`);
  console.log("question                                             vec  txt  hyb");
  console.log("-".repeat(72));
  for (const r of results) {
    const mark = (x) => (x === null ? "  - " : x.hit ? " OK " : x.n === 0 ? " -- " : " ?? ");
    console.log(
      r.q.slice(0, 50).padEnd(52) + mark(r.vector) + mark(r.text) + mark(r.hybrid),
    );
  }
  console.log("-".repeat(72));
  console.log(`correct passage retrieved:  vector ${tally("vector")}/${QUESTIONS.length}` +
    `   text ${tally("text")}/${QUESTIONS.length}` +
    (results[0].hybrid ? `   hybrid ${tally("hybrid")}/${QUESTIONS.length}` : "   hybrid n/a"));
  console.log(`returned nothing at all:    vector ${empty("vector")}` +
    `   text ${empty("text")}` +
    (results[0].hybrid ? `   hybrid ${empty("hybrid")}` : ""));
  console.log("\nOK = right passage   ?? = something, but not the right passage   -- = nothing");

  writeFileSync(
    join(__dirname, `benchmark_${label}.json`),
    JSON.stringify(results, null, 1),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
