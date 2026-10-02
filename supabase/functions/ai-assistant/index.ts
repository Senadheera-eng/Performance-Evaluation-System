// PES AI Assistant.
//
// Every student message arrives here. This used to be an escalation tier at
// the back of a queue — a keyword cascade and a vector search were tried
// first, and whatever they recognised was answered from a template string
// with numbers slotted into it. The model saw almost nothing, which is why
// the assistant read as a set of canned replies.
//
// Now the model is the thing that answers, and it decides for itself which
// of the tools below to call.
//
// Grounding contract: the model may only state facts that came back from a
// tool call. It never computes GPA/CGPA itself — that is delegated to
// calculate_gpa_target / get_academic_standing, the same RPCs the rest of
// the app uses, so there is exactly one source of truth for that maths, not
// two. Every tool runs through the caller's own token, so row-level security
// decides what it can see: a student cannot ask this about anyone else.
//
// Which model answers is configuration, not code (see providers.ts): a model
// the faculty runs itself, such as Llama or Qwen under Ollama, and/or Gemini
// with one or more API keys, tried in order. A provider that is rate limited,
// busy or down is stepped past to the next, so one spent allowance is not an
// outage.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  answerWithFirstAvailable,
  configuredProviders,
  geminiModelInUse,
  Unavailable,
  type ChatStart,
  type Provider,
} from "./providers.ts";
import { presentResult, simplifyForSmallModel, sourcesOf, toolHint } from "./present.ts";
import {
  COMPACT_SYSTEM_INSTRUCTION,
  COMPACT_TOOLS,
  SYSTEM_INSTRUCTION,
  TOOLS,
} from "./prompts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

/*
  Our own usage caps, both configurable.

  PES is still in development and the only person using the assistant is the
  developer, so caps sized for a faculty of 167 were getting in the way of
  the one person who needs to try it. The defaults are now high enough not to
  be felt, and AI_DAILY_QUOTA / AI_PER_STUDENT_DAILY tighten them for release
  without a deploy.

  They are not removed altogether. What they still protect against is not a
  busy student but a runaway loop — a retry that never stops, or a client bug
  that sends the same question a thousand times. That failure does not care
  how many users there are.

  Note these are OUR caps. Gemini's own limit is separate and much lower: the
  free tier allows a handful of requests per minute, and one question costs
  several. An earlier comment here claimed 1,500 requests per day, which is
  not the limit that actually bites.
*/
const DAILY_QUOTA = Number(Deno.env.get("AI_DAILY_QUOTA") ?? 5000);
const PER_STUDENT_DAILY = Number(Deno.env.get("AI_PER_STUDENT_DAILY") ?? 1000);

/* Raised from 4. With the model choosing its own tools rather than being
   handed a pre-classified intent, a real question often needs two or three
   lookups — standing, then the target, then the course list — and the old
   ceiling cut some answers off mid-reasoning. */
const MAX_TOOL_TURNS = 6;

/*
  Which model to call.

  This used to be a single hardcoded string. If that string names a model the
  API does not serve, every request 404s, the function returns a 502, and the
  caller falls back to a canned reply — so the assistant looks merely unhelpful
  rather than broken, and nothing says why. Model names also come and go, which
  makes a single hardcoded one a scheduled outage.

  So: GEMINI_MODEL overrides, otherwise the first candidate that answers is
  used and remembered for the life of the instance. A model-not-found is
  logged loudly and moves to the next candidate; any other error is a real
  error and is surfaced.
*/
const MODEL_CANDIDATES = [
  Deno.env.get("GEMINI_MODEL"),
  // Confirmed live on 10 September 2026. The previous hardcoded value was
  // "gemini-3.5-flash", which the API answers with 404 — so every call this
  // function ever made to Gemini failed, and the assistant fell back to its
  // canned replies without anything saying why.
  "gemini-3.6-flash",
  // gemini-2.5-flash used to sit here as a fallback. It is gone: the API
  // answers "no longer available to new users", so every attempt to fall
  // back to it spent a round trip on a guaranteed 404 and filled the log
  // with a failure that was not the real one. A candidate that cannot
  // serve is not a fallback. Add a real second model here, or set
  // GEMINI_MODEL, if one becomes available.
].filter((m): m is string => !!m);

/*
  The providers, in the order they are tried. Configured by secrets:
    LOCAL_LLM_URL, LOCAL_LLM_MODEL, LOCAL_LLM_API_KEY  the faculty's own model
    GEMINI_API_KEYS (comma-separated) and/or GEMINI_API_KEY
    AI_PROVIDERS  the order, default "local,gemini"
*/
const PROVIDERS: Provider[] = configuredProviders((name) => Deno.env.get(name), MODEL_CANDIDATES);

/* When each provider may next be tried, by provider id. A key that has had
   its share for the minute -- or the day -- is left alone until then rather
   than costing every question a refused round trip. Lives as long as the
   worker does, which is long enough to matter on a busy day. */
const cooldownUntil = new Map<string, number>();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** The `role` claim of an already-gateway-verified bearer token, or null. */
function jwtRole(authHeader: string): string | null {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (PROVIDERS.length === 0) {
    return jsonResponse(
      { error: "No AI model is configured: set LOCAL_LLM_URL or GEMINI_API_KEY(S)" },
      500,
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  let message: string;
  let isDiagnose = false;
  let history: { role: "user" | "assistant"; content: string }[] = [];
  try {
    const body = await req.json();
    isDiagnose = body.diagnose === true;
    message = body.message;
    if (!isDiagnose && (!message || typeof message !== "string")) {
      throw new Error("bad message");
    }
    if (Array.isArray(body.history)) {
      history = body.history
        .filter(
          (h: unknown): h is { role: string; content: string } =>
            !!h &&
            typeof (h as Record<string, unknown>).content === "string" &&
            ((h as Record<string, unknown>).role === "user" ||
              (h as Record<string, unknown>).role === "assistant"),
        )
        .slice(-8) as { role: "user" | "assistant"; content: string }[];
    }
  } catch {
    return jsonResponse(
      { error: "Invalid request body — expected JSON { message: string }" },
      400,
    );
  }

  /* The platform kills a worker that runs too long, and a killed worker never
     reaches an error handler: the caller gets WORKER_RESOURCE_LIMIT and the
     logs say nothing. Stopping ourselves in time to say something is better
     than being stopped. A model on the faculty's own hardware can be slower
     than Gemini, so the deadline is configurable, but it stays under the
     platform's own limit. */
  const DEADLINE_MS = Math.min(Number(Deno.env.get("AI_DEADLINE_MS") ?? 60_000), 140_000);
  const RETRY_WAIT_MS = 21_000;
  /* An overloaded model is not a spent quota — it clears in seconds, not in a
     rate-limit window, so waiting the full window would burn the deadline for
     nothing. */
  const OVERLOAD_WAIT_MS = 4_000;
  const MAX_RATE_LIMIT_RETRIES = 2;
  const startedAt = Date.now();
  let ranOutOfTime = false;

  // Scoped to the calling student's own session — every RPC call through
  // this client resolves auth.uid() to the real student server-side, same
  // as every other RPC call in this app. Never used for anything beyond
  // what that student is already allowed to see via RLS.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  // Separate service-role client used ONLY for the internal usage-quota
  // log — never touches student academic data.
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  /* Operator health check. Answers the one question that cannot be answered
     from outside this function: which of the configured models and keys
     actually answer. Gated on the service role key itself — a student token can never
     reach it, and it touches no academic data. */
  if (isDiagnose) {
    /* Read the role out of the token rather than string-comparing it to the
       service key: the platform may inject that key in a different format
       than the one an operator holds, and the gateway has already verified
       this token's signature, so the claim is trustworthy. */
    if (jwtRole(authHeader) !== "service_role") {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    /* A fingerprint of the prompt actually running. Deploys currently go
       through a tool that takes the source inline rather than a file, so
       this is how an operator confirms the deployed prompt is the one in
       the repository and not a mistyped copy of it. */
    const promptDigest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SYSTEM_INSTRUCTION)),
      ),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);

    const report: Record<string, unknown> = {
      providers: PROVIDERS.map((p) => p.label),
      gemini_model_candidates: MODEL_CANDIDATES,
      tools: TOOLS[0].functionDeclarations.map((t) => t.name),
      max_tool_turns: MAX_TOOL_TURNS,
      deadline_ms: DEADLINE_MS,
      per_student_daily: PER_STUDENT_DAILY,
      prompt_sha256_16: promptDigest,
    };
    /* Every provider is probed, not just the first: a backup key that was
       revoked months ago is exactly what nobody notices until it is needed. */
    report.probes = await Promise.all(
      PROVIDERS.map(async (p) => {
        const began = Date.now();
        try {
          const turn = await p
            .start({
              system: "You are a health check.",
              history: [],
              message: "Reply with the single word: ok",
              tools: [],
              temperature: 0,
            })
            .next(30_000);
          return { provider: p.label, ok: true, reply: turn.text, ms: Date.now() - began };
        } catch (err) {
          return {
            provider: p.label,
            ok: false,
            reason: err instanceof Unavailable ? err.reason : "error",
            error: err instanceof Error ? err.message : String(err),
            ms: Date.now() - began,
          };
        }
      }),
    );
    report.gemini_model = geminiModelInUse();
    const { count: chunkCount } = await adminClient
      .from("handbook_chunks")
      .select("*", { count: "exact", head: true });
    report.handbook_chunks = chunkCount;
    const { count: siteChunkCount } = await adminClient
      .from("faculty_site_chunks")
      .select("*", { count: "exact", head: true });
    report.faculty_site_chunks = siteChunkCount;
    return jsonResponse(report);
  }

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData?.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const studentId = authData.user.id;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { count } = await adminClient
    .from("ai_assistant_usage_log")
    .select("*", { count: "exact", head: true })
    .gte("created_at", todayStart.toISOString());

  if ((count ?? 0) >= DAILY_QUOTA) {
    return jsonResponse({
      reply:
        "The assistant has reached its shared daily limit for the whole faculty, so I can't answer right now — it resets tomorrow. Your **Results**, **Graduation Planner** and **Enrollment** pages have the same information in the meantime.",
    });
  }

  const { count: mine } = await adminClient
    .from("ai_assistant_usage_log")
    .select("*", { count: "exact", head: true })
    .eq("student_id", studentId)
    .gte("created_at", todayStart.toISOString());

  if ((mine ?? 0) >= PER_STUDENT_DAILY) {
    return jsonResponse({
      reply:
        `You've used your ${PER_STUDENT_DAILY} assistant messages for today — the limit is there so one busy day doesn't use up the allowance the whole faculty shares. It resets tomorrow.\n\nYour **Results**, **Graduation Planner** and **Enrollment** pages have the same information whenever you need it.`,
    });
  }

  await adminClient.from("ai_assistant_usage_log").insert({ student_id: studentId });

  // Best-effort personalization only — never a grounding fact reported back
  // as data, just used to make greetings feel natural. RLS already scopes
  // this to the caller's own row, same as every RPC above.
  const { data: studentRow } = await userClient
    .from("students")
    .select("name")
    .eq("id", studentId)
    .single();
  const studentFirstName =
    typeof studentRow?.name === "string" ? studentRow.name.split(" ")[0] : null;

  /* Today's date, where the faculty is. Without it "this semester" or "is
     the deadline over" has no answer, and the calendar's dates are only a
     list: asked for this semester's exams, the model gave last March's. */
  const today = new Date().toLocaleDateString("en-GB", {
    timeZone: "Asia/Colombo",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  /* Kept apart from the instructions so the instructions are the same for
     every student: a local model server then reads them once and reuses
     them, instead of reading them again for every question. */
  const questionContext = [
    `Today is ${today} in Sri Lanka. Use it for "this semester", "next week", "upcoming" and whether a date has passed. If the academic calendar does not reach the date asked about, say so rather than answering with another semester's dates.`,
    studentFirstName
      ? `The student you're talking to is named ${studentFirstName} — you may use their first name occasionally where it feels natural (e.g. in a greeting), but don't overdo it.`
      : null,
  ].filter(Boolean).join("\n\n");

  async function executeTool(name: string, args: Record<string, unknown>) {
    switch (name) {
      case "get_academic_standing": {
        const { data, error } = await userClient.rpc("get_academic_standing");
        return error ? { error: error.message } : data;
      }
      case "calculate_gpa_target": {
        const { data, error } = await userClient.rpc("calculate_gpa_target", {
          p_target_cgpa: args.p_target_cgpa,
        });
        return error ? { error: error.message } : data;
      }
      case "get_upcoming_courses": {
        const { data, error } = await userClient.rpc("get_upcoming_courses");
        return error ? { error: error.message } : data;
      }
      case "get_courses_by_semester": {
        const { data, error } = await userClient.rpc("get_courses_by_semester", {
          p_semester: args.p_semester,
        });
        return error ? { error: error.message } : data;
      }
      case "get_course_info": {
        const { data, error } = await userClient.rpc("get_course_info", {
          p_search: args.p_search,
        });
        return error ? { error: error.message } : data;
      }
      case "get_student_results": {
        const { data, error } = await userClient.rpc("get_student_results", {
          p_semester: args.p_semester ?? null,
          p_course_search: args.p_course_search ?? null,
        });
        return error ? { error: error.message } : data;
      }
      case "get_student_course_result": {
        const { data, error } = await userClient.rpc("get_student_course_result", {
          p_search: args.p_search,
        });
        return error ? { error: error.message } : data;
      }
      case "get_my_attendance": {
        const { data, error } = await userClient.rpc("get_my_attendance");
        return error ? { error: error.message } : data;
      }
      case "get_my_minor_progress": {
        const { data, error } = await userClient.rpc("get_my_minor_progress");
        return error ? { error: error.message } : data;
      }
      case "my_outstanding_modules": {
        const { data, error } = await userClient.rpc("my_outstanding_modules");
        return error ? { error: error.message } : { outstanding: data };
      }
      case "get_my_insights": {
        const { data, error } = await userClient.rpc("get_my_insights");
        return error ? { error: error.message } : data;
      }
      case "get_my_medical_submissions": {
        const { data, error } = await userClient.rpc("get_my_medical_submissions");
        return error ? { error: error.message } : data;
      }
      case "search_handbook": {
        /* Hybrid, not the old keyword search. websearch_to_tsquery ANDed
           every word of the question, which found nothing for 15 of 18 real
           student questions — the model was being told the handbook had no
           answer when it did. The hybrid function ORs the query's lexemes
           and gets 18 of 18. No embedding is passed: measured on the same
           questions, the text half alone is already correct, and requiring
           an embedding here would mean running a model server-side for no
           gain. */
        const { data, error } = await userClient.rpc("search_handbook_hybrid", {
          p_query: args.p_search,
          p_embedding: null,
          p_limit: 4,
        });
        return error ? { error: error.message } : data;
      }
      case "search_faculty_website": {
        const { data, error } = await userClient.rpc("search_faculty_site", {
          p_query: args.p_query,
          p_limit: 5,
        });
        if (error) return { error: error.message };
        return (data ?? []).length ? data : { results: [], note: "Nothing on the faculty website matched." };
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  const chat: ChatStart = {
    system: SYSTEM_INSTRUCTION,
    context: questionContext,
    compact: { system: COMPACT_SYSTEM_INSTRUCTION, tools: COMPACT_TOOLS, hint: toolHint(message) },
    history,
    message,
    tools: TOOLS[0].functionDeclarations,
    // Greetings/small talk benefit from a little more natural variation
    // than the grounded-answer default; the model still can't invent
    // facts since tool results are unaffected by this.
    temperature: 0.4,
  };

  const outcome = await answerWithFirstAvailable({
    providers: PROVIDERS,
    cooldownUntil,
    chat,
    executeTool,
    present: { result: presentResult, sources: sourcesOf, simplify: simplifyForSmallModel },
    startedAt,
    deadlineMs: DEADLINE_MS,
    maxToolTurns: MAX_TOOL_TURNS,
    maxWaits: MAX_RATE_LIMIT_RETRIES,
    shortWaitMs: OVERLOAD_WAIT_MS,
    longWaitMs: RETRY_WAIT_MS,
  });
  const { answeredBy, rateLimited, realError, failures } = outcome;
  const finalText = outcome.text;
  ranOutOfTime = outcome.ranOutOfTime;

  if (answeredBy === null) {
    if (!realError && rateLimited) {
      console.warn("ai-assistant: rate limited everywhere");
      return jsonResponse({
        reply:
          "I'm being rate limited by the AI service — it allows only a few requests a minute, and one question uses several of them. I already waited and tried again. Give it a minute and ask once more.",
      });
    }
    if (!realError && ranOutOfTime) {
      return jsonResponse({
        reply:
          "That one took me longer than I'm allowed — the AI model was too slow to answer in time. Try again in a moment, or ask it in a smaller piece.",
      });
    }
    if (!realError) {
      return jsonResponse({
        reply:
          "I can't reach the AI model right now — it may be busy or restarting. Give it a minute and ask again. Your **Results**, **Graduation Planner** and **Enrollment** pages have the same information in the meantime.",
      });
    }
    /* Say what actually failed. A bare "Internal error" is how a wrong model
       name once passed for a merely unhelpful assistant for weeks. */
    console.error("ai-assistant: no provider could answer:", failures.join(" | "));
    return jsonResponse(
      { error: "AI service error", detail: failures.join(" | ").slice(0, 500) },
      502,
    );
  }
  console.log(`ai-assistant: answered by ${answeredBy}`);

  if (!finalText) {
    return jsonResponse({
      reply: ranOutOfTime
        ? "That one took me longer than I'm allowed — I was still looking things up when I ran out of time. Try asking it in a smaller piece, like your standing first and then the target."
        : "I wasn't able to work out an answer to that — could you try rephrasing, or ask something more specific?",
    });
  }

  return jsonResponse({ reply: finalText });
});
