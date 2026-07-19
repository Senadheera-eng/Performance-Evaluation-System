// Held-out accuracy test for the semantic intent classifier. These phrases
// are deliberately NOT copies of intent_examples.mjs — different wording,
// typos, and casing — to measure genuine generalization rather than just
// confirming the classifier can recognize its own training examples.
import { pipeline } from "@huggingface/transformers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const embeddingsPath = join(
  __dirname,
  "..",
  "..",
  "pes_app",
  "src",
  "lib",
  "intentEmbeddings.json",
);
const { entries } = JSON.parse(readFileSync(embeddingsPath, "utf-8"));

const CONFIDENCE_THRESHOLD = 0.55;

const TEST_CASES = [
  // gpa_target
  ["wat gpa do i need 2 get first class", "gpa_target"],
  ["how can i graduate with a good classification", "gpa_target"],
  ["im aiming for upper division whats needed", "gpa_target"],
  ["what score should i be getting each sem to hit 3.7", "gpa_target"],
  ["how do i end up with first class honours", "gpa_target"],
  ["whats the sgpa needed for upper div", "gpa_target"],
  ["i wanna know my gpa goal for a good degree", "gpa_target"],

  // current_standing
  ["whats my cgpa atm", "current_standing"],
  ["how am i doing academically right now", "current_standing"],
  ["current classification pls", "current_standing"],
  ["hows my gpa looking", "current_standing"],
  ["credits ive finished so far", "current_standing"],
  ["what year/sem am i in now", "current_standing"],
  ["my present academic standing", "current_standing"],

  // upcoming_courses
  ["wat subjects do i have comin up", "upcoming_courses"],
  ["gimme my next sem modules", "upcoming_courses"],
  ["courses im taking after this semester", "upcoming_courses"],
  ["how many credits will next semester be", "upcoming_courses"],
  ["what am i studying next term", "upcoming_courses"],
  ["future semester course list", "upcoming_courses"],

  // course_info
  ["wut is co3201 about", "course_info"],
  ["can u explain the machine learning module", "course_info"],
  ["credits for engineering mathematics 5", "course_info"],
  ["is data mining a hard module", "course_info"],
  ["gimme info on the cloud computing course", "course_info"],
  ["does natural language processing count for gpa", "course_info"],
  ["whats covered in software engineering", "course_info"],

  // greeting
  ["heyy", "greeting"],
  ["hai", "greeting"],
  ["good afternoon!", "greeting"],
  ["morning", "greeting"],

  // help
  ["wat can this bot do", "help"],
  ["how does this assistant work exactly", "help"],
  ["what kinda stuff can i ask u", "help"],
  ["show me what youre capable of", "help"],
  ["gimme some example questions", "help"],

  // adversarial: genuinely off-topic, should NOT confidently match any intent
  ["what is the weather like today", "unknown"],
  ["can you help me with my python homework", "unknown"],
  ["whats the capital of france", "unknown"],
  ["tell me a joke", "unknown"],
];

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both sides are already L2-normalized
}

function classify(vec) {
  let best = null;
  let bestSim = -1;
  for (const example of entries) {
    const sim = cosineSimilarity(vec, example.embedding);
    if (sim > bestSim) {
      bestSim = sim;
      best = example;
    }
  }
  if (!best || bestSim < CONFIDENCE_THRESHOLD) return { intent: "unknown", confidence: bestSim };
  return { intent: best.intent, confidence: bestSim, matchedExample: best.phrase };
}

async function main() {
  const embed = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

  let correct = 0;
  const failures = [];

  for (const [phrase, expected] of TEST_CASES) {
    const result = await embed(phrase, { pooling: "mean", normalize: true });
    const vec = Array.from(result.data);
    const { intent, confidence, matchedExample } = classify(vec);
    const ok = intent === expected;
    if (ok) correct++;
    else failures.push({ phrase, expected, got: intent, confidence: confidence.toFixed(3), matchedExample });
  }

  console.log(`\nAccuracy: ${correct}/${TEST_CASES.length} (${((correct / TEST_CASES.length) * 100).toFixed(1)}%)\n`);
  if (failures.length > 0) {
    console.log("Failures:");
    for (const f of failures) {
      console.log(`  "${f.phrase}" -> expected ${f.expected}, got ${f.got} (conf ${f.confidence}, closest: "${f.matchedExample ?? "n/a"}")`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
