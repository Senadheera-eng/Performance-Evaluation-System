// ============================================================
// PES — export the applied schema history into the repository
//
//   node export_migrations.cjs
//
// The migration history lives in the Supabase project's
// supabase_migrations.schema_migrations table and nowhere else. Without it
// in git, the schema — including every RLS policy the system's access rules
// depend on — cannot be reviewed, recreated in another environment, or
// recovered if the project goes away.
//
// Reads through a service_role-only RPC because supabase_migrations is not
// an exposed API schema. Writes supabase/migrations/<version>_<name>.sql in
// the layout the Supabase CLI expects, so `supabase db push` works against a
// fresh project later.
// ============================================================

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const OUT_DIR = path.resolve(__dirname, "..", "supabase", "migrations");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Supabase CLI filenames are <version>_<snake_case_name>.sql. */
function fileNameFor(version, name) {
  const slug = (name || "migration")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${version}_${slug || "migration"}.sql`;
}

async function main() {
  const { data, error } = await supabase.rpc("export_migrations");
  if (error) {
    console.error(`Could not read the migration history: ${error.message}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Anything already there that is no longer in the history would be a
  // stale file claiming to be applied schema. Start from a clean directory.
  for (const existing of fs.readdirSync(OUT_DIR)) {
    if (existing.endsWith(".sql")) fs.unlinkSync(path.join(OUT_DIR, existing));
  }

  let written = 0;
  let statements = 0;
  for (const row of data) {
    const body = (row.statements ?? [])
      .map((s) => (s.trimEnd().endsWith(";") ? s.trimEnd() : `${s.trimEnd()};`))
      .join("\n\n");
    const header =
      `-- ${row.name ?? "migration"}\n` +
      `-- Applied ${row.version}\n` +
      `-- Exported from the live project; do not edit by hand.\n\n`;
    fs.writeFileSync(path.join(OUT_DIR, fileNameFor(row.version, row.name)), header + body + "\n");
    written += 1;
    statements += (row.statements ?? []).length;
  }

  console.log(`Exported ${written} migrations (${statements} statements) to`);
  console.log(`  ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
