// Chunks the Faculty Handbook 2026 text and embeds each chunk locally
// (Xenova/all-MiniLM-L6-v2, 384-dim, runs fully offline after the model is
// cached — no API key, no per-run cost). Output is NDJSON; loading it into
// Supabase is a separate step (done via the Supabase MCP connection, not
// from this script, since this script has no DB credentials).
//
// Usage: node chunk_and_embed.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pipeline } from "@xenova/transformers";

// Sections that are low-value for an academic-policy/course chatbot (staff
// directories, clubs/societies, front-matter, contact listings) — dropped
// to keep the embedded corpus focused and the data volume manageable at
// full embedding precision (an earlier dimensionality-reduction attempt
// measurably hurt ranking quality, so precision is being kept intact and
// corpus size is the lever instead).
const DROP_SECTIONS = new Set([
  "Academic Support Staff",
  "Academic Supporting Staff",
  "Non-academic Staff",
  "Career Guidance Unit",
  "Civil Engineering Society",
  "Computer Engineering Society",
  "E 2 CLUB",
  "IEEE Student Branch",
  "IESL Student Chapter",
  "IET Sri Lanka Network",
  "IET Young Professionals",
  "IMechE - University of Sri Jayewardenepura Student Chapter",
  "Congratulations",
  "CONTACT INFORMATION",
  "Editorial Remarks",
  "Photographs",
  "MESSAGE FROM THE DEAN",
  "MESSAGE FROM THE VICE-CHANCELLOR",
  "Nexus CLUB",
  "Sports and Recreation",
  "Canteen and Convenience Store",
  "Computer Center",
  "Mechanical Engineering Members Society",
  "MEMS Biomedical Engineering",
  "Research and Innovation",
  "Stability",
  "OFFICE OF THE DEAN",
  "UNIVERSITY STUDENT COUNCIL, FACULTY UNION, AND SOCIETIES",
  "History",
  "University Today",
  "New Faculty Premises",
  "Beyond the Classroom: A Holistic Campus Life",
  "Study Programme 15",
]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(__dirname, "handbook_source.txt");
const OUTPUT_PATH = join(__dirname, "handbook_chunks.ndjson");

const MIN_CHUNK_WORDS = 40;
const TARGET_CHUNK_WORDS = 160;
const MAX_CHUNK_WORDS = 260;

const DEPARTMENT_HINTS = [
  ["Department of Civil Engineering", "Civil Engineering"],
  ["Department of Computer Engineering", "Computer Engineering"],
  [
    "Department of Electrical and Electronic Engineering",
    "Electrical and Electronic Engineering",
  ],
  ["Department of Mechanical Engineering", "Mechanical Engineering"],
  ["Department of Interdisciplinary Studies", "Inter-departmental"],
];

function looksLikeHeading(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 70) return false;
  if (/[.;:]$/.test(trimmed)) return false; // headings don't end mid-sentence
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return false;
  const isAllCaps = letters === letters.toUpperCase();
  const isTitleCase =
    /^[A-Z]/.test(trimmed) &&
    trimmed.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).length >=
      Math.max(1, trimmed.split(/\s+/).length - 2);
  return isAllCaps || isTitleCase;
}

function detectDepartment(section) {
  const hit = DEPARTMENT_HINTS.find(([marker]) => section.includes(marker));
  return hit ? hit[1] : null;
}

function paragraphsForPage(pageText) {
  return pageText
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0 && !/^\d{1,4}$/.test(p)); // drop bare page numbers
}

function buildChunks(rawText) {
  const pages = rawText.split("\f");
  const chunks = [];
  let currentSection = "Faculty of Engineering — Student Guide 2026";
  let currentDepartment = null;

  pages.forEach((pageText, pageIndex) => {
    const pageNumber = pageIndex + 1;
    const paragraphs = paragraphsForPage(pageText);

    let buffer = [];
    let bufferWords = 0;

    const flush = () => {
      if (buffer.length === 0) return;
      chunks.push({
        content: buffer.join(" "),
        section: currentSection,
        page: pageNumber,
        department: currentDepartment,
      });
      buffer = [];
      bufferWords = 0;
    };

    for (const para of paragraphs) {
      const firstLine = para.split(/(?<=[.!?])\s/)[0];
      if (looksLikeHeading(firstLine) && firstLine.length === para.length) {
        // Whole paragraph is a short heading-shaped line — treat as a
        // section marker rather than content, and start a fresh chunk.
        flush();
        currentSection = para;
        currentDepartment = detectDepartment(currentSection) ?? currentDepartment;
        continue;
      }

      const paraWords = para.split(/\s+/).length;

      if (paraWords > MAX_CHUNK_WORDS) {
        // Long paragraph (e.g. a squashed course table) — split on sentence
        // boundaries and pack into ~TARGET_CHUNK_WORDS pieces.
        flush();
        const sentences = para.split(/(?<=[.!?])\s+/);
        let piece = [];
        let pieceWords = 0;
        for (const s of sentences) {
          const w = s.split(/\s+/).length;
          if (pieceWords + w > TARGET_CHUNK_WORDS && piece.length > 0) {
            chunks.push({
              content: piece.join(" "),
              section: currentSection,
              page: pageNumber,
              department: currentDepartment,
            });
            piece = [];
            pieceWords = 0;
          }
          piece.push(s);
          pieceWords += w;
        }
        if (piece.length > 0) {
          chunks.push({
            content: piece.join(" "),
            section: currentSection,
            page: pageNumber,
            department: currentDepartment,
          });
        }
        continue;
      }

      if (bufferWords + paraWords > MAX_CHUNK_WORDS && bufferWords >= MIN_CHUNK_WORDS) {
        flush();
      }
      buffer.push(para);
      bufferWords += paraWords;
      if (bufferWords >= TARGET_CHUNK_WORDS) {
        flush();
      }
    }
    flush();
  });

  // Merge any leftover tiny chunks (< MIN_CHUNK_WORDS) into the previous one
  // so we don't embed near-empty fragments.
  const merged = [];
  for (const c of chunks) {
    const words = c.content.split(/\s+/).length;
    if (
      words < MIN_CHUNK_WORDS &&
      merged.length > 0 &&
      merged[merged.length - 1].page === c.page
    ) {
      merged[merged.length - 1].content += " " + c.content;
    } else {
      merged.push(c);
    }
  }
  return merged.filter((c) => c.content.split(/\s+/).length >= 8);
}

async function main() {
  console.log("Reading", SOURCE_PATH);
  const rawText = readFileSync(SOURCE_PATH, "utf-8");

  const allChunks = buildChunks(rawText);
  const chunks = allChunks.filter((c) => !DROP_SECTIONS.has(c.section));
  console.log(
    `Built ${allChunks.length} chunks, kept ${chunks.length} after dropping low-value sections. Loading embedding model...`,
  );

  const embed = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
  );

  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const result = await embed(c.content, { pooling: "mean", normalize: true });
    const vector = Array.from(result.data);
    out.push({ ...c, embedding: vector });
    if ((i + 1) % 25 === 0 || i === chunks.length - 1) {
      console.log(`Embedded ${i + 1}/${chunks.length}`);
    }
  }

  writeFileSync(OUTPUT_PATH, out.map((o) => JSON.stringify(o)).join("\n"));
  console.log("Wrote", OUTPUT_PATH);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
