import { embedText, cosineSimilarity } from "./embedder";
import intentEmbeddingsData from "./intentEmbeddings.json";

/**
 * Semantic (embedding-based) intent classifier — replaces the old
 * keyword-cascade approach in chatbotEngine.ts's classifyIntent(). Instead
 * of matching against hand-written phrase lists, this embeds the student's
 * message and finds the closest canonical example (see
 * pes-scripts/intent/intent_examples.mjs) by cosine similarity. Whichever
 * intent that example belongs to wins.
 *
 * This generalizes to real phrasing/typos the keyword list never
 * anticipated, without needing a new keyword added for every variant a
 * student happens to type — that's the whole reason this replaced the
 * keyword cascade (see the two bugs it caused: "how do I calculate my
 * GPA" routing to current_standing, and "semester 7 modules" mangling in
 * the course-code search).
 */

export type ClassifiableIntent =
  | "gpa_target"
  | "current_standing"
  | "upcoming_courses"
  | "course_info"
  | "greeting"
  | "help";

interface IntentExample {
  intent: ClassifiableIntent;
  phrase: string;
  embedding: number[];
}

const EXAMPLES = (intentEmbeddingsData as { entries: IntentExample[] }).entries;

// Below this, the closest example still isn't a confident match — better to
// fall through to "unknown" (which itself falls through to handbook search)
// than to force a guess. Tuned empirically alongside HANDBOOK_MIN_SIMILARITY
// in chatbotEngine.ts; MiniLM cosine similarity for short phrases runs
// lower than intuition suggests.
const CONFIDENCE_THRESHOLD = 0.55;

export interface ClassificationResult {
  intent: ClassifiableIntent | "unknown";
  confidence: number;
  matchedExample?: string;
}

export async function classifyIntentSemantic(
  message: string,
): Promise<ClassificationResult> {
  const messageVec = await embedText(message);

  let best: IntentExample | null = null;
  let bestSim = -1;

  for (const example of EXAMPLES) {
    const sim = cosineSimilarity(messageVec, example.embedding);
    if (sim > bestSim) {
      bestSim = sim;
      best = example;
    }
  }

  if (!best || bestSim < CONFIDENCE_THRESHOLD) {
    return { intent: "unknown", confidence: bestSim };
  }

  return { intent: best.intent, confidence: bestSim, matchedExample: best.phrase };
}
