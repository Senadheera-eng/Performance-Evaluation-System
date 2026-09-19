// Loads handbook_chunks.ndjson into Supabase directly via supabase-js —
// no LLM transcription step, so there's no risk of the silent content
// corruption that read-file-then-retype-into-a-tool-call approaches hit at
// this data volume (each row's embedding is 384 floats; an agent retyping
// that from context is regenerating text, not copying bytes).
//
// Usage:
//   cd pes-scripts/rag
//   SUPABASE_SERVICE_ROLE_KEY=<service role key from Supabase dashboard> node load_chunks.mjs
//
// The service role key is required (not the anon key) because this bypasses
// RLS to bulk-insert reference data. Get it from:
//   Supabase Dashboard > Project Settings > API > service_role secret
// Never commit this key or share it — treat it like a database root password.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL || "https://cktbxkxhthoqeyvzspav.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error(
    "ERROR: set SUPABASE_SERVICE_ROLE_KEY as an environment variable before running this script.\n" +
      "Get it from: Supabase Dashboard > Project Settings > API > service_role secret",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const lines = readFileSync(join(__dirname, "handbook_chunks.ndjson"), "utf-8")
    .split("\n")
    .filter(Boolean);
  const rows = lines.map((l) => JSON.parse(l));

  console.log(`Loaded ${rows.length} chunks from handbook_chunks.ndjson`);

  const { count: existing } = await supabase
    .from("handbook_chunks")
    .select("*", { count: "exact", head: true });
  if (existing && existing > 0) {
    console.error(
      `ERROR: handbook_chunks already has ${existing} rows. Refusing to insert on top of existing data — truncate the table first if you intend to reload.`,
    );
    process.exit(1);
  }

  const BATCH_SIZE = 20;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({
      content: r.content,
      section: r.section,
      page: r.page,
      department: r.department,
      embedding: r.embedding,
    }));
    const { error } = await supabase.from("handbook_chunks").insert(batch);
    if (error) {
      console.error(`Batch starting at row ${i} failed:`, error.message);
      process.exit(1);
    }
    console.log(`Inserted rows ${i + 1}-${Math.min(i + BATCH_SIZE, rows.length)}`);
  }

  const { count } = await supabase
    .from("handbook_chunks")
    .select("*", { count: "exact", head: true });
  console.log(`Done. Final row count: ${count}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
