// Replaces the contents of handbook_chunks with handbook_chunks_v2.ndjson.
//
// Unlike load_chunks.mjs this is a REPLACE, not a first-time load, so it
// takes the old rows out to a local file first. The backup is a file rather
// than a backup table on purpose: an unprotected copy of a table sitting in
// the public schema is exactly the kind of thing the September 2026 security
// review flagged, and there is no reason to create another one.
//
// Usage:
//   cd pes-scripts/rag
//   node reload_chunks_v2.mjs            # dry run: reports what it would do
//   node reload_chunks_v2.mjs --apply    # take the backup, then replace
//
// The service role key is read from pes_app/.env.local (it bypasses RLS to
// write reference data). Never commit or share that key.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", "..", "pes_app", ".env.local");
const INPUT_PATH = join(__dirname, "handbook_chunks_v2.ndjson");

function readEnv(key) {
  const env = readFileSync(ENV_PATH, "utf-8");
  const m = env.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : null;
}

const SUPABASE_URL = readEnv("VITE_SUPABASE_URL");
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || readEnv("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(`ERROR: could not read Supabase URL / service role key from ${ENV_PATH}`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const apply = process.argv.includes("--apply");

async function main() {
  const rows = readFileSync(INPUT_PATH, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const { count: existing } = await supabase
    .from("handbook_chunks")
    .select("*", { count: "exact", head: true });

  console.log(`current rows in handbook_chunks : ${existing}`);
  console.log(`rows to load from v2 NDJSON      : ${rows.length}`);

  if (!apply) {
    console.log("\ndry run — pass --apply to take the backup and replace.");
    return;
  }

  // 1. Back up what is there now, embeddings included, so this is reversible.
  const backupPath = join(
    __dirname,
    `handbook_chunks_backup_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.ndjson`,
  );
  const old = [];
  const PAGE = 200;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("handbook_chunks")
      .select("content, section, page, department, embedding")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("backup read failed:", error.message);
      process.exit(1);
    }
    old.push(...data);
    if (data.length < PAGE) break;
  }
  writeFileSync(backupPath, old.map((o) => JSON.stringify(o)).join("\n"));
  console.log(`backed up ${old.length} rows -> ${backupPath.split(/[\\/]/).pop()}`);

  if (old.length !== existing) {
    console.error(
      `ERROR: backed up ${old.length} rows but the table reports ${existing}. Refusing to delete.`,
    );
    process.exit(1);
  }

  // 2. Clear, then load.
  const { error: delError } = await supabase
    .from("handbook_chunks")
    .delete()
    .not("id", "is", null);
  if (delError) {
    console.error("delete failed:", delError.message);
    process.exit(1);
  }
  console.log("cleared handbook_chunks");

  const BATCH = 20;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r) => ({
      content: r.content,
      section: r.section,
      page: r.page,
      department: r.department,
      embedding: r.embedding,
    }));
    const { error } = await supabase.from("handbook_chunks").insert(batch);
    if (error) {
      console.error(`batch at row ${i} failed:`, error.message);
      console.error(`restore with the backup file if needed: ${backupPath}`);
      process.exit(1);
    }
  }

  const { count: final } = await supabase
    .from("handbook_chunks")
    .select("*", { count: "exact", head: true });
  console.log(`done. final row count: ${final}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
