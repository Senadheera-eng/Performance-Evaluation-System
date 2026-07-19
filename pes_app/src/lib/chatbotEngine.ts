import { supabase } from "./supabase";
import { searchHandbook } from "./ragRetrieval";

/**
 * Rule-based NLU engine for the PES AI Assistant.
 *
 * No external LLM API is used. Every question type below maps to a real
 * Postgres RPC function (the same ones the Graduation Planner and Enrollment
 * pages use), so answers are always backed by real data — never guessed.
 *
 * Robustness to typos/phrasing comes from fuzzy keyword matching plus a
 * PRIORITY-ORDERED classifier (checked most-specific-first), rather than raw
 * keyword-count scoring — that's what fixes "what's my current CGPA?" being
 * misread as a GPA *target* question just because "gpa" fuzzy-matches inside
 * "cgpa".
 */

// ---------- Fuzzy matching helpers ----------

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** True if `keyword` appears in `text`, tolerating small typos for single words. */
function fuzzyContains(text: string, keyword: string): boolean {
  const normalized = text.toLowerCase();
  if (normalized.includes(keyword)) return true;
  if (keyword.includes(" ")) return false; // multi-word phrases need exact substring
  const maxDist = keyword.length <= 4 ? 1 : 2;
  return normalized
    .split(/\s+/)
    .some((word) => levenshtein(word, keyword) <= maxDist);
}

function anyMatch(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => fuzzyContains(text, kw));
}

// ---------- Intent classification (priority order, not pure scoring) ----------

type Intent =
  | "gpa_target"
  | "current_standing"
  | "upcoming_courses"
  | "course_info"
  | "greeting"
  | "help"
  | "unknown";

function classifyIntent(message: string): Intent {
  const text = message.toLowerCase().trim();

  // Greetings: only when the message IS essentially just a greeting (short,
  // no other question content) — not merely "hi" followed by a real question.
  const wordCount = text.split(/\s+/).length;
  const isPureGreeting =
    wordCount <= 4 &&
    /^(hi|hey|hello|good morning|good afternoon|good evening)[\s!.,]*$/.test(
      text,
    );
  if (isPureGreeting) {
    return "greeting";
  }
  if (anyMatch(text, ["what can you do", "what do you do", "capabilities", "help me", "how do you work"])) {
    return "help";
  }

  // --- GPA TARGET: only when there's a genuine forward-looking signal ---
  // (an explicit number, a classification name, or "how should I perform" style phrasing)
  const hasNumber = /\b[0-4]\.\d{1,2}\b/.test(text);
  const hasClassificationWord =
    fuzzyContains(text, "first class") ||
    text.includes("second class") ||
    text.includes("upper division") ||
    text.includes("lower division") ||
    text.includes("second upper") ||
    text.includes("second lower");
  const hasForwardPhrase = anyMatch(text, [
    "how should i perform",
    "how do i graduate",
    "graduate with",
    "graduation gpa",
    "i want a",
    "i want to get",
    "i need to score",
    "aim for",
    "target",
    "what do i need",
    "what should i score",
    "what should i get",
  ]);

  if (hasNumber || hasClassificationWord || hasForwardPhrase) {
    return "gpa_target";
  }

  // "How is GPA calculated" / "how do I calculate my GPA" asks for the
  // formula, not the caller's personal number — despite containing "my
  // gpa", it should NOT match the current-standing checks below. Checked
  // once here so it can gate both the early and the bare-fallback match.
  const asksHowCalculated = anyMatch(text, [
    "how is gpa calculated",
    "how is cgpa calculated",
    "how do i calculate",
    "how to calculate",
    "gpa formula",
    "how does gpa work",
    "how gpa is calculated",
    "how gpa works",
  ]);

  // --- CURRENT STANDING: asking about right now, not a future goal ---
  // Deliberately checked BEFORE any generic "gpa"/"cgpa" catch-all, since
  // "current", "my", "so far" are strong signals this is about today.
  if (
    !asksHowCalculated &&
    anyMatch(text, [
      "current cgpa",
      "current gpa",
      "my cgpa",
      "my gpa",
      "how am i doing",
      "my progress",
      "so far",
      "credits completed",
      "credits remaining",
      "my classification",
      "current standing",
      "my standing",
    ])
  ) {
    return "current_standing";
  }

  // --- UPCOMING COURSES ---
  if (
    anyMatch(text, [
      "next semester",
      "next sem",
      "upcoming course",
      "upcoming subject",
      "coming semester",
      "what subjects",
      "what subjets", // common typo, kept explicit since edit-distance to "subjects" is >2
      "what courses",
      "which courses",
      "which subjects",
      "modules next",
      "subjects next",
      "credits in next",
      "credits next semester",
    ])
  ) {
    return "upcoming_courses";
  }

  // --- COURSE INFO LOOKUP ---
  if (
    anyMatch(text, [
      "tell me about",
      "what is",
      "info about",
      "information about",
      "details about",
      "about the module",
      "about the course",
    ])
  ) {
    return "course_info";
  }

  // Fallback: a bare "gpa"/"cgpa" mention with none of the above signals —
  // treat as a current-standing question, since that's the more common intent
  // for an unqualified "what's my gpa" style message. Formula/how-to questions
  // fall through to "unknown" instead, where the handbook fallback answers
  // them correctly (the actual GPA formula, not the caller's personal number).
  if (!asksHowCalculated && anyMatch(text, ["gpa", "cgpa", "grade point"])) {
    return "current_standing";
  }

  if (anyMatch(text, ["module", "course", "subject"])) {
    return "course_info";
  }

  return "unknown";
}

// ---------- Slot extraction ----------

function extractTargetCgpa(message: string): number | null {
  const numberMatch = message.match(/\b([0-4]\.\d{1,2})\b/);
  if (numberMatch) return parseFloat(numberMatch[1]);

  const normalized = message.toLowerCase();
  if (fuzzyContains(normalized, "first class")) return 3.7;
  if (
    normalized.includes("upper division") ||
    normalized.includes("second upper") ||
    normalized.includes("2nd upper")
  )
    return 3.3;
  if (
    normalized.includes("lower division") ||
    normalized.includes("second lower") ||
    normalized.includes("2nd lower")
  )
    return 3.0;
  if (normalized.includes("pass")) return 2.0;

  return null;
}

function wantsCreditTotalOnly(message: string): boolean {
  const text = message.toLowerCase();
  return (
    (text.includes("how many credit") || text.includes("total credit")) &&
    !text.includes("what") // "what are the credits" reads more like a list request
  );
}

const COURSE_INFO_STRIP_PHRASES = [
  "tell me about",
  "what is",
  "what's",
  "info about",
  "information about",
  "details about",
  "give me details on",
  "about the module",
  "about the course",
  "the module",
  "the course",
  "module",
  "course",
  "?",
];

// Course titles use Roman numerals ("Engineering Mathematics V") and full
// words ("Mathematics", not "Maths") — normalize common shorthand so a
// casual search like "maths 5" still finds "Engineering Mathematics V".
const WORD_EXPANSIONS: Record<string, string> = {
  maths: "math",
  eng: "engineering",
  comp: "computer",
  elec: "electrical",
  mech: "mechanical",
  civ: "civil",
  mgmt: "management",
  intro: "introduction",
};

const ROMAN_NUMERALS = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

function normalizeSearchWords(term: string): string {
  return term
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (WORD_EXPANSIONS[word]) return WORD_EXPANSIONS[word];
      const asNumber = Number(word);
      if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= 10) {
        return ROMAN_NUMERALS[asNumber];
      }
      return word;
    })
    .join(" ");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractCourseSearchTerm(message: string): string {
  let cleaned = message.toLowerCase();
  for (const phrase of COURSE_INFO_STRIP_PHRASES) {
    // Word-boundary + global match: a literal (non-boundary) replace here
    // would strip "module" out of "modules" and leave a stray "s" behind,
    // and only remove the first occurrence of each phrase.
    const pattern = /^[a-z ']+$/.test(phrase)
      ? new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "g")
      : new RegExp(escapeRegExp(phrase), "g");
    cleaned = cleaned.replace(pattern, " ");
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return normalizeSearchWords(cleaned);
}

// ---------- Response builders (real data only, via RPC, written conversationally) ----------

async function handleGpaTarget(message: string): Promise<string> {
  const target = extractTargetCgpa(message);
  if (target === null) {
    return "Happy to help plan that out — what CGPA or classification are you aiming for? For example, \"I want a 3.5 GPA\" or \"How do I graduate with First Class?\"";
  }
  if (target < 2.0 || target > 4.0) {
    return "CGPA targets run from 2.00 to 4.00 here — mind giving me a number in that range?";
  }

  const { data, error } = await supabase.rpc("calculate_gpa_target", {
    p_target_cgpa: target,
  });
  if (error) return `Hmm, I couldn't run that calculation just now (${error.message}). Mind trying again in a bit?`;
  if (data.error) return data.error;

  if (data.already_graduated_credits) {
    return `You've already completed all 144 required credits — your final CGPA is locked in at ${data.current_cgpa}.`;
  }
  if (data.already_secured) {
    return `Good news — you've basically already got this one in the bag! Even if you scored a 0.00 average across your remaining ${data.remaining_credits} credits, you'd still finish above a ${target.toFixed(2)} CGPA. You're currently sitting at ${data.current_cgpa}.`;
  }
  if (!data.feasible) {
    return `I have to be straight with you — a ${target.toFixed(2)} CGPA isn't reachable anymore, it would take more than a 4.00 average in your remaining ${data.remaining_credits} credits. The best you could still finish with is ${data.best_possible_cgpa}, and that's only with A+ in everything left.`;
  }

  const semText = (data.semester_breakdown ?? [])
    .map((s: any) => `Semester ${s.semester} (${s.estimated_credits} credits)`)
    .join(" and ");

  return `Here's the plan: to land a ${target.toFixed(2)} CGPA, you'll want to average around ${data.required_avg_sgpa_per_remaining_semester} SGPA in each of your remaining semesters${semText ? " — that's " + semText : ""}. You're at ${data.current_cgpa} right now with ${data.remaining_credits} credits to go, so your ceiling if everything goes perfectly is ${data.best_possible_cgpa}.`;
}

async function handleCurrentStanding(): Promise<string> {
  const { data, error } = await supabase.rpc("get_academic_standing");
  if (error) return `I couldn't pull up your standing just now (${error.message}) — try again shortly?`;

  return `You're currently at a ${data.current_cgpa} CGPA, having finished ${data.credits_completed} of the 144 credits you need (${data.credits_remaining} left to go). That puts you through Semester ${data.highest_completed_semester}. If you graduated today, you'd land in: ${data.current_classification}.`;
}

async function handleUpcomingCourses(message: string): Promise<string> {
  const { data, error } = await supabase.rpc("get_upcoming_courses");
  if (error) return `Couldn't fetch your upcoming courses just now (${error.message}) — give it another try?`;

  if (!data.courses || data.courses.length === 0) {
    return `I don't have course data loaded for Semester ${data.next_semester} in ${data.department} yet — worth checking with your department directly.`;
  }

  const totalCredits = data.courses.reduce(
    (sum: number, c: any) => sum + (c.credits ?? 0),
    0,
  );

  if (wantsCreditTotalOnly(message)) {
    return `Semester ${data.next_semester} adds up to ${totalCredits} credits across ${data.courses.length} courses in ${data.department}. Want the full breakdown? Just ask what subjects you're taking.`;
  }

  const lines = data.courses
    .map(
      (c: any) =>
        `• ${c.code} — ${c.title} (${c.credits} credits${c.minor_category ? `, ${c.minor_category} minor` : ""
        }${!c.contributes_to_gpa ? ", non-GPA" : ""})`,
    )
    .join("\n");

  return `Here's what's on your plate for Semester ${data.next_semester} in ${data.department} (${totalCredits} credits total):\n\n${lines}`;
}

async function handleCourseInfo(message: string): Promise<string> {
  const searchTerm = extractCourseSearchTerm(message);
  if (!searchTerm) {
    return "Sure — which course or module did you want to know about? Something like \"Tell me about Mathematics V\" or \"What is CO3554?\" works.";
  }

  const { data, error } = await supabase.rpc("get_course_info", {
    p_search: searchTerm,
  });
  if (error) return `Couldn't look that up just now (${error.message}) — try again?`;

  const matches = data.matches ?? [];
  if (matches.length === 0) {
    // Not every course-shaped question is a single-course lookup — "semester
    // 7 modules" isn't a course title, but the handbook has real per-semester
    // course listings that can answer it. Try that before giving up, using
    // the original message (not the mangled single-course search term).
    const handbookReply = await handleHandbookFallback(message);
    if (handbookReply !== UNKNOWN_REPLY) return handbookReply;
    return `I couldn't find anything matching "${searchTerm}" — maybe try the exact course code, or a shorter piece of the title?`;
  }

  if (matches.length === 1) {
    const c = matches[0];
    return `${c.code} — ${c.title}. It's a ${c.credits}-credit ${c.category.toLowerCase()} course${c.minor_category ? ` under the ${c.minor_category} minor` : ""
      }, offered in Semester ${c.semester} (Year ${c.year}) for ${c.department}. ${c.contributes_to_gpa
        ? "It counts toward your GPA."
        : "It doesn't count toward your GPA."
      }`;
  }

  const lines = matches
    .map(
      (c: any) =>
        `• ${c.code} — ${c.title} (Sem ${c.semester}, ${c.department})`,
    )
    .join("\n");
  return `A few things matched "${searchTerm}":\n\n${lines}\n\nAsk about a specific code and I'll give you the full details.`;
}

const GREETING_REPLY =
  "Hey! I can help with your GPA/CGPA targets, your current standing, upcoming courses, and specific module info. Try something like \"What GPA do I need for First Class?\" or \"What are my next semester courses?\"";

const HELP_REPLY =
  "Here's what I'm good for right now:\n\n• GPA/CGPA planning — \"I want a 3.5 GPA, how should I perform?\"\n• Your current standing — \"What's my CGPA?\"\n• Upcoming courses — \"What subjects do I have next semester?\"\n• Course lookups — \"Tell me about Mathematics V\"\n\nEverything I tell you comes straight from your real academic records, so the numbers are always accurate — I won't guess.";

const UNKNOWN_REPLY =
  "I didn't quite catch what you're looking for. Right now I can help with your GPA/CGPA targets, your current standing, upcoming courses, course lookups, and general Faculty Handbook questions — try rephrasing, or ask \"what can you do\" for examples.";

// Below this similarity, the best handbook match isn't a real answer to the
// question — better to admit we don't know than to return a loosely-related
// paragraph and let the reader assume it's relevant. Threshold is tuned
// empirically for MiniLM cosine similarity on this corpus, which runs much
// lower (~0.3-0.45 for genuinely correct matches) than intuition suggests.
const HANDBOOK_MIN_SIMILARITY = 0.3;

/**
 * Fallback for anything that doesn't match one of the known intents above:
 * semantic search over the Faculty Handbook 2026 (local embeddings, pgvector
 * search via the `search_handbook` RPC — see ragRetrieval.ts). The reply is
 * the retrieved handbook text itself, with a citation, never a
 * model-generated paraphrase — so there's nothing here that can be
 * fabricated beyond what's actually printed in the handbook.
 */
async function handleHandbookFallback(message: string): Promise<string> {
  let matches: Awaited<ReturnType<typeof searchHandbook>>;
  try {
    matches = await searchHandbook(message, {
      matchCount: 2,
      minSimilarity: HANDBOOK_MIN_SIMILARITY,
    });
  } catch {
    return UNKNOWN_REPLY;
  }

  if (matches.length === 0) {
    return UNKNOWN_REPLY;
  }

  const top = matches[0];
  const citation = top.page
    ? `Faculty Handbook 2026, p.${top.page}${top.section ? ` ("${top.section}")` : ""}`
    : "Faculty Handbook 2026";

  return `From the Faculty Handbook: ${top.content}\n\n(Source: ${citation}. If this doesn't fully answer your question, try rephrasing or check with your department.)`;
}

/** Main entry point — classify the message and return a real, data-backed reply. */
export async function getAssistantReply(message: string): Promise<string> {
  const intent = classifyIntent(message);

  switch (intent) {
    case "gpa_target":
      return handleGpaTarget(message);
    case "current_standing":
      return handleCurrentStanding();
    case "upcoming_courses":
      return handleUpcomingCourses(message);
    case "course_info":
      return handleCourseInfo(message);
    case "greeting":
      return GREETING_REPLY;
    case "help":
      return HELP_REPLY;
    default:
      return handleHandbookFallback(message);
  }
}