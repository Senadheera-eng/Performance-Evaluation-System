// Chunks the Faculty Handbook 2026 and embeds each chunk locally
// (Xenova/all-MiniLM-L6-v2, 384-dim, offline once the model caches — no API
// key, no per-run cost). Output is NDJSON; loading it into Supabase is a
// separate step.
//
// This replaces chunk_and_embed.mjs. Four things changed, each for a reason
// that was measured rather than assumed:
//
//  1. Input is handbook_structured.json, produced by extract_handbook.py,
//     which finds headings from the PDF's own typography. The old pipeline
//     guessed headings from the text shape and, on a clean extraction with
//     no blank lines between paragraphs, collapsed 96 pages into 8 sections.
//
//  2. Chunks OVERLAP. The old pipeline cut the text into disjoint pieces, so
//     a rule split across a boundary was findable in neither half.
//
//  3. The section heading is embedded WITH the body. The paragraph that
//     defines the Dean's List never contains the words "Dean's List" — its
//     heading does, and the heading is what a student's question resembles.
//
//  4. Far less is dropped. The old DROP_SECTIONS list removed about half the
//     handbook, including sections carrying real policy. Only genuinely
//     non-academic pages go now: staff directories, club pages, ceremonial
//     messages.
//
// Usage:
//   node chunk_and_embed_v2.mjs --dry     analyse only, no embedding
//   node chunk_and_embed_v2.mjs           chunk + embed -> NDJSON

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(__dirname, "handbook_structured.json");
const OUTPUT_PATH = join(__dirname, "handbook_chunks_v2.ndjson");

/* Only what cannot answer an academic question. Staff and club listings are
   names and phone numbers; the ceremonial messages are prose about the
   faculty rather than rules about it. Everything else stays — including the
   department curriculum pages, where the minors and the per-semester course
   tables live. */
const DROP_SECTION_PATTERNS = [
  /^(prof|dr|mr|mrs|ms|eng)\.?\s/i,          // a person, i.e. a staff page
  /staff$/i,
  /society$/i,
  /club$/i,
  /^ieee /i,
  /^iesl student chapter$/i,
  /^iet /i,
  /^imeche/i,
  /^message from/i,
  /^contact information$/i,
  /^editorial remarks$/i,
  /^photographs?$/i,
  /^congratulations$/i,
  /^sports and recreation$/i,
  /^canteen/i,
  /^table of content/i,
  /^acknowledge?ments?$/i,
];

const TARGET_CHUNK_WORDS = 150;
const MAX_CHUNK_WORDS = 230;
/** Words of the previous chunk repeated at the head of the next one. */
const OVERLAP_WORDS = 40;
/** Below this a record is folded into its neighbour rather than embedded alone. */
const MIN_CHUNK_WORDS = 25;

const DEPARTMENT_HINTS = [
  ["Civil Engineering", "Civil Engineering"],
  ["Computer Engineering", "Computer Engineering"],
  ["Electrical and Electronic Engineering", "Electrical and Electronic Engineering"],
  ["Mechanical Engineering", "Mechanical Engineering"],
  ["Interdisciplinary Studies", "Inter-departmental"],
];

const isDropped = (section) =>
  DROP_SECTION_PATTERNS.some((re) => re.test(String(section).trim()));

function detectDepartment(section) {
  const hit = DEPARTMENT_HINTS.find(([marker]) => section.includes(marker));
  return hit ? hit[1] : null;
}

/** Split one record's text into overlapping chunks of roughly TARGET words. */
function splitWithOverlap(words) {
  if (words.length <= MAX_CHUNK_WORDS) return [words];
  const out = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + TARGET_CHUNK_WORDS, words.length);
    out.push(words.slice(start, end));
    if (end >= words.length) break;
    start = end - OVERLAP_WORDS;
  }
  return out;
}

function buildChunks(records) {
  // Consecutive records sharing a section belong together; joining them first
  // means the overlap is computed across the whole section rather than
  // restarting at every paragraph break.
  const grouped = [];
  for (const r of records) {
    const prev = grouped[grouped.length - 1];
    if (prev && prev.section === r.section && r.page - prev.endPage <= 1) {
      prev.text += " " + r.text;
      prev.endPage = r.page;
    } else {
      grouped.push({ section: r.section, page: r.page, endPage: r.page, text: r.text });
    }
  }

  const chunks = [];
  for (const g of grouped) {
    if (isDropped(g.section)) continue;
    const words = g.text.split(/\s+/).filter(Boolean);
    if (words.length < 8) continue;
    for (const piece of splitWithOverlap(words)) {
      chunks.push({
        content: piece.join(" "),
        section: g.section,
        page: g.page,
        department: detectDepartment(g.section),
      });
    }
  }

  // Fold anything still too small into the previous chunk of the same section.
  const merged = [];
  for (const c of chunks) {
    const prev = merged[merged.length - 1];
    if (
      c.content.split(/\s+/).length < MIN_CHUNK_WORDS &&
      prev &&
      prev.section === c.section
    ) {
      prev.content += " " + c.content;
    } else {
      merged.push(c);
    }
  }
  return merged;
}

/** What actually gets embedded: the heading, then the body. */
export function embedTextFor(chunk) {
  return `${chunk.section}\n\n${chunk.content}`;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const records = JSON.parse(readFileSync(SOURCE_PATH, "utf-8"));

  const chunks = buildChunks(records);
  const chars = chunks.reduce((n, c) => n + c.content.length, 0);
  const sections = new Set(chunks.map((c) => c.section));

  console.log(`records  ${records.length}`);
  console.log(`chunks   ${chunks.length}`);
  console.log(`chars    ${chars.toLocaleString()}`);
  console.log(`sections ${sections.size}`);
  console.log(`pages    ${Math.min(...chunks.map((c) => c.page))}-${Math.max(...chunks.map((c) => c.page))}`);

  if (dry) {
    const dropped = [...new Set(records.map((r) => r.section).filter(isDropped))];
    console.log(`\ndropped ${dropped.length} sections, e.g.`);
    dropped.slice(0, 12).forEach((s) => console.log("  -", s));
    return;
  }

  const { pipeline } = await import("@huggingface/transformers");
  const embed = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const r = await embed(embedTextFor(chunks[i]), { pooling: "mean", normalize: true });
    out.push({ ...chunks[i], embedding: Array.from(r.data) });
    if ((i + 1) % 50 === 0 || i === chunks.length - 1) {
      console.log(`embedded ${i + 1}/${chunks.length}`);
    }
  }

  writeFileSync(OUTPUT_PATH, out.map((o) => JSON.stringify(o)).join("\n"));
  console.log("wrote", OUTPUT_PATH);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
