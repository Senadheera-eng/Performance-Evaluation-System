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
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
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

let resolvedModel: string | null = null;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "get_academic_standing",
        description:
          "Get the calling student's REAL current CGPA, credits completed, credits remaining, current semester, and current degree classification. Takes no arguments — it always resolves to whichever student is asking.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "calculate_gpa_target",
        description:
          "Calculate the exact average SGPA the student needs across their remaining semesters to reach a target CGPA, with feasibility and a per-semester credit breakdown.",
        parameters: {
          type: "OBJECT",
          properties: {
            p_target_cgpa: {
              type: "NUMBER",
              description: "Target CGPA, must be between 2.0 and 4.0",
            },
          },
          required: ["p_target_cgpa"],
        },
      },
      {
        name: "get_upcoming_courses",
        description:
          "Get the REAL list of courses in the student's own next semester, derived from their actual completed-semester progress. Takes no arguments. Only use this for 'my next semester' — if the student names a specific semester number, use get_courses_by_semester instead.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "get_courses_by_semester",
        description:
          "Get the REAL list of courses offered in a specific, named semester (1-8) for the student's department — independent of the student's own progress. Use this whenever the student names a semester number (e.g. 'semester 5', 'sem 3'), whether it's in their past, their actual next semester, or further ahead.",
        parameters: {
          type: "OBJECT",
          properties: {
            p_semester: {
              type: "NUMBER",
              description: "Semester number, 1 through 8",
            },
          },
          required: ["p_semester"],
        },
      },
      {
        name: "get_course_info",
        description:
          "Look up a specific course/module's catalog details — credits, category, which semester it's offered. This is curriculum metadata, NOT the student's own grade. Use get_student_course_result instead if the student is asking what THEY got in a course.",
        parameters: {
          type: "OBJECT",
          properties: {
            p_search: {
              type: "STRING",
              description: "Course name, partial title, or course code",
            },
          },
          required: ["p_search"],
        },
      },
      {
        name: "get_student_results",
        description:
          "Get the calling student's REAL published results (course code, title, credits, grade) and GPA. Pass p_semester to filter to one semester (1-8), p_course_search to filter to a specific course by code or name (e.g. 'CO3554' or 'Mathematics'), or both together (e.g. 'my semester 2 result for maths 2'). Omit both for every published result. This is the ONLY correct source for 'my results' / 'my grades' questions — never use search_handbook or get_courses_by_semester for this, those return curriculum data, not the student's actual grades.",
        parameters: {
          type: "OBJECT",
          properties: {
            p_semester: {
              type: "NUMBER",
              description: "Optional. Semester number 1-8 to filter to. Omit for all semesters.",
            },
            p_course_search: {
              type: "STRING",
              description: "Optional. Course code or name to filter to within the semester (or overall if p_semester is omitted).",
            },
          },
        },
      },
      {
        name: "get_student_course_result",
        description:
          "Get the calling student's REAL grade for one specific course, by course code or name (e.g. 'CO3554' or 'Data Management'). Use this when the student asks what grade/mark they got in a named course.",
        parameters: {
          type: "OBJECT",
          properties: {
            p_search: { type: "STRING", description: "Course code or name" },
          },
          required: ["p_search"],
        },
      },
      {
        name: "get_my_attendance",
        description:
          "The calling student's REAL attendance: overall percentage, the faculty minimum and pre-warning thresholds, how many lectures have been recorded, and a per-course breakdown. Takes no arguments. Excused absences count toward compliance exactly as present does, so do not subtract them. If no lectures have been recorded yet, say that rather than reporting zero percent. A course the student repeated appears once per attempt, each with its own register and its own percentage: the 'attempt' field says which one counts and which was superseded, and only the one that counts is in the overall figure. Never average the attempts together.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "get_my_minor_progress",
        description:
          "Which minor streams the student's own department offers, how many credits each needs, exactly which courses count toward each one, and which of those the student has already passed. This is the ONLY source that knows which specific courses make up a minor — the handbook names the streams but not their courses. Use it for any question about minors or fields of specialization. Takes no arguments.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "my_outstanding_modules",
        description:
          "Modules the calling student still owes because they carry an R, F or L grade, and must take again. Takes no arguments. This says what is outstanding, not whether an enrolment window is currently open — for that, send them to the Enrollment page.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "get_my_insights",
        description:
          "What the system has noticed about this student without being asked: attendance below or near the faculty minimum, a semester GPA that has fallen or risen sharply, a medical certificate close to or past its deadline, an open enrolment window, and modules still outstanding. Each carries a severity of critical, warning, info or positive. This is the same set the student sees on their Dashboard, so use it when they ask how they are doing, whether anything needs attention, or what they should worry about — and mention a critical one even if they only asked something adjacent. Takes no arguments.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "get_my_medical_submissions",
        description:
          "The calling student's medical certificate submissions and what happened to each: the dates missed, the submission deadline, the overall status, and the decision per module — each module on a certificate is reviewed separately, so one submission can be approved for some and rejected for others. Takes no arguments.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "search_handbook",
        description:
          "Search the Faculty Handbook 2026 for policies and regulations — grading, GPA, re-sits, repeating a course, degree and graduation requirements, class honours, the Dean's List, minors and fields of specialization, industrial training, academic concessions. Pass the student's question as you received it; the search handles a natural sentence and does not need keywords picked out of it. Note the handbook covers regulations only: it does not contain the student's own records, and it has almost nothing about attendance rules.",
        parameters: {
          type: "OBJECT",
          properties: {
            p_search: {
              type: "STRING",
              description:
                "The question in natural language, e.g. 'what happens if I fail a course'",
            },
          },
          required: ["p_search"],
        },
      },
    ],
  },
];

const SYSTEM_INSTRUCTION = `You are the academic assistant inside PES, the Performance Evaluation System used by Faculty of Engineering students at the University of Sri Jayewardenepura. You are talking to one student about their own degree.

## Grounding — these override any instinct to be more helpful

- State ONLY facts that came back from a tool call in this conversation. Never estimate, infer, or round a number a tool did not return.
- Never do GPA or CGPA arithmetic yourself, however simple it looks. Call calculate_gpa_target or get_academic_standing and report what they return. There is one source of truth for that maths and it is not you.
- If a tool errors or returns nothing, say so plainly. Do not fill the gap with something plausible.
- For anything personal — results, grades, GPA, standing — use get_student_results, get_student_course_result, get_academic_standing or calculate_gpa_target. Never answer a personal question from search_handbook or get_courses_by_semester: those are policy and curriculum, not this student's record. If no results exist for the semester asked about, say exactly that; never substitute another semester's results, and never describe a curriculum as though it answered a question about grades.
- When you use search_handbook, cite the section and page from the result. If the first search comes back thin, try once more with different wording before concluding there is no answer.

## Reaching for tools

- Look things up rather than asking the student for information you can fetch. You already know who they are.
- A real question often needs more than one lookup. To advise on a target, get their standing first, then the target calculation. Chain them.
- When you need two lookups that do not depend on each other, ask for them in the SAME turn rather than one after the other. Each turn is a separate request against a tight rate limit, so batching is the difference between an answer and a refusal.
- Only skip tools entirely for greetings and small talk.
- When a student asks how they are doing, get_my_insights alongside their standing. A CGPA on its own is not how they are doing if their attendance is about to cost them a module. If an insight is marked critical, say it even when they asked about something else.

## What you cannot do yet

You cannot see course feedback, and you cannot tell whether an enrolment window is currently open — my_outstanding_modules says what a student still owes, not whether they can enrol for it today. You also cannot change anything: you read records, you never submit, enrol or withdraw.

For those, say plainly that you cannot see it and name the page that can: Feedback, or Enrollment. Do not guess, and never use the handbook as a substitute for a record you cannot read.

## Voice

- Write like a knowledgeable final-year student answering a friend: warm, direct, specific. Not a formal report, not a customer-service bot.
- Answer the question that was asked. Do not append a menu of your capabilities to every reply, and do not list what you can do unless the student asks.
- Never open with an apology or a restatement of the question. Start with the answer.
- Read the conversation so far. "What about semester 5?" means the same question they just asked, about semester 5.
- Vary your wording between replies. Use the student's first name occasionally, not every time.
- Bad news is delivered straight and kindly: if a target is out of reach, say so, give the real ceiling, and say what is still reachable.
- Do not oversell a tight one either. "Feasible" from a tool means arithmetically possible, not likely. If the required average is close to the maximum, or the ceiling is barely above the target, say plainly how little room there is — "you would need near-perfect grades from here, the most you can now reach is X" — rather than calling it definitely reachable. A student who relaxes because you sounded confident is worse off than one you were honest with.
- Markdown where it genuinely helps — a table for a list of results, bold for the number that matters, short paragraphs. Never format a one-line answer or a greeting.
- Keep it short. Two or three sentences is usually right. Length is not helpfulness.`;

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

  if (!GEMINI_API_KEY) {
    return jsonResponse({ error: "GEMINI_API_KEY is not configured" }, 500);
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

  /* Declared before anything can call Gemini — the health check below does,
     and these are what bound its waiting.

     The platform kills a worker that runs too long, and a killed worker never
     reaches an error handler: the caller gets WORKER_RESOURCE_LIMIT and the
     logs say nothing. Stopping ourselves in time to say something is better
     than being stopped. */
  const DEADLINE_MS = 60_000;
  const RETRY_WAIT_MS = 21_000;
  /* An overloaded model is not a spent quota — it clears in seconds, not in a
     rate-limit window, so waiting the full window would burn the deadline for
     nothing. */
  const OVERLOAD_WAIT_MS = 4_000;
  const MAX_RATE_LIMIT_RETRIES = 2;
  const startedAt = Date.now();
  let rateLimitRetries = 0;
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
     from outside this function: which Gemini model this key can actually
     serve. Gated on the service role key itself — a student token can never
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
      candidates: MODEL_CANDIDATES,
      tools: TOOLS[0].functionDeclarations.map((t) => t.name),
      max_tool_turns: MAX_TOOL_TURNS,
      per_student_daily: PER_STUDENT_DAILY,
      prompt_sha256_16: promptDigest,
    };
    try {
      const probe = await callGemini({
        contents: [{ role: "user", parts: [{ text: "Reply with the single word: ok" }] }],
      });
      report.working_model = resolvedModel;
      report.reply = probe.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    } catch (err) {
      report.working_model = null;
      report.error = err instanceof Error ? err.message : String(err);
    }
    const { count: chunkCount } = await adminClient
      .from("handbook_chunks")
      .select("*", { count: "exact", head: true });
    report.handbook_chunks = chunkCount;
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

  const systemInstructionText = studentFirstName
    ? `${SYSTEM_INSTRUCTION}\n\nThe student you're talking to is named ${studentFirstName} — you may use their first name occasionally where it feels natural (e.g. in a greeting), but don't overdo it.`
    : SYSTEM_INSTRUCTION;

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
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  // deno-lint-ignore no-explicit-any
  const historyContents: any[] = history.map((h) => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: [{ text: h.content }],
  }));
  // deno-lint-ignore no-explicit-any
  const contents: any[] = [
    ...historyContents,
    { role: "user", parts: [{ text: message }] },
  ];
  let finalText: string | null = null;

  /* Calls Gemini, trying each candidate model until one is actually served.
     Only a "model not found" moves on to the next; every other failure is a
     real failure and is returned. */
  // deno-lint-ignore no-explicit-any
  async function callGemini(body: Record<string, unknown>): Promise<any> {
    /* When a model is already resolved, keep the rest of the list behind it
       rather than dropping it: if that model has just run out of its daily
       allowance, the others are exactly what we need. */
    const tryList = resolvedModel
      ? [resolvedModel, ...MODEL_CANDIDATES.filter((m) => m !== resolvedModel)]
      : MODEL_CANDIDATES;
    let lastError = "";
    let rateLimitedSomewhere = false;

    for (const model of tryList) {
      // Inner loop so a rate-limit retry goes back to the SAME model. A
      // `continue` on the outer loop would quietly fall through to the next
      // candidate, which is a different question entirely.
      let res: Response;
      for (;;) {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        /* 429 is "you have had your share this minute"; 503 is "this model
           is busy right now, try again". The API says so itself, in those
           words. Both are worth waiting out, and a 503 needs only a moment
           rather than a whole rate-limit window — treating it as a hard
           failure turned a transient spike into a visible "I can't reach the
           assistant" for the student. */
        const transient = res.status === 429 || res.status === 503;
        if (!transient) break;
        const waitMs = res.status === 503 ? OVERLOAD_WAIT_MS : RETRY_WAIT_MS;

        /* Gemini's free tier allows only a handful of requests per minute,
           and one question costs several — the first call plus one per tool
           turn. So the limit is reached by asking two questions in a row, not
           by being popular.

           It is also a limit you wait out rather than one you are out of: the
           window is a minute. Waiting and trying again is what a person would
           do, so this does it — bounded by the deadline, so it can still
           answer rather than be killed mid-wait. */
        const elapsed = Date.now() - startedAt;
        const roomToWait = elapsed + waitMs + 8_000 < DEADLINE_MS;
        if (rateLimitRetries >= MAX_RATE_LIMIT_RETRIES || !roomToWait) break;

        rateLimitRetries++;
        console.warn(
          `ai-assistant: ${model} returned ${res.status}, waiting ${waitMs}ms (retry ${rateLimitRetries})`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
      }

      if (res.ok) {
        if (resolvedModel !== model) {
          console.log(`ai-assistant: using model ${model}`);
          resolvedModel = model;
        }
        return await res.json();
      }

      lastError = await res.text();

      /* Still 429 after the waiting above. Rate limits are counted PER MODEL
         — the console shows a separate requests-per-day figure for each — so
         a candidate that is out of allowance says nothing about the next
         one. Fall through and try it, exactly as for a model that does not
         exist. Only when every candidate is exhausted does this become an
         error the student sees. */
      if (res.status === 429 || res.status === 503) {
        rateLimitedSomewhere = true;
        console.warn(
          `ai-assistant: model "${model}" returned ${res.status} after retries — trying the next candidate`,
        );
        if (resolvedModel === model) resolvedModel = null;
        continue;
      }

      const notFound =
        res.status === 404 || /not found|not supported|unsupported model/i.test(lastError);
      if (!notFound) throw new Error(`Gemini ${res.status}: ${lastError.slice(0, 400)}`);

      console.error(
        `ai-assistant: model "${model}" is not available to this key — trying the next candidate. ${lastError.slice(0, 200)}`,
      );
      if (resolvedModel === model) resolvedModel = null; // it stopped working
    }

    if (rateLimitedSomewhere) {
      const err = new Error(
        `every model is rate limited (tried ${tryList.join(", ")})`,
      ) as Error & { rateLimited?: boolean };
      err.rateLimited = true;
      throw err;
    }

    throw new Error(
      `No usable Gemini model. Tried: ${tryList.join(", ")}. Last error: ${lastError.slice(0, 400)}`,
    );
  }

  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      if (Date.now() - startedAt > DEADLINE_MS) {
        ranOutOfTime = true;
        console.warn(`ai-assistant: deadline hit after ${turn} tool turns`);
        break;
      }
      const geminiData = await callGemini({
        contents,
        tools: TOOLS,
        systemInstruction: { parts: [{ text: systemInstructionText }] },
        // Greetings/small talk benefit from a little more natural variation
        // than the grounded-answer default; the model still can't invent
        // facts since tool results are unaffected by this.
        generationConfig: { temperature: 0.4 },
      });

      const candidate = geminiData.candidates?.[0];
      // deno-lint-ignore no-explicit-any
      const parts: any[] = candidate?.content?.parts ?? [];

      // deno-lint-ignore no-explicit-any
      const calls = parts.filter((p: any) => p.functionCall);

      if (calls.length > 0) {
        /* Echo the model's turn back exactly as it came.

           This used to rebuild the part as { functionCall: { name, args } },
           which drops the thought_signature Gemini 3 attaches to it — and
           the API rejects the next request outright:
           "Function call is missing a thought_signature in functionCall
           parts". Every question that needed a tool failed with a 400, so
           only greetings, which call no tools, ever worked.

           All calls in the turn are answered, not just the first: the model
           can ask for two lookups at once, and serving one of them silently
           dropped the other. */
        contents.push(candidate.content);

        const responses = [];
        for (const part of calls) {
          const { name, args } = part.functionCall;
          const result = await executeTool(name, args ?? {});
          responses.push({ functionResponse: { name, response: { result } } });
        }
        contents.push({ role: "user", parts: responses });
        continue;
      }

      // deno-lint-ignore no-explicit-any
      const textPart = parts.find((p: any) => typeof p.text === "string");
      finalText = textPart?.text ?? null;
      break;
    }
  } catch (err) {
    if ((err as { rateLimited?: boolean })?.rateLimited) {
      console.warn("ai-assistant: rate limited by Gemini");
      return jsonResponse({
        reply:
          "I'm being rate limited by the AI service — it allows only a few requests a minute, and one question uses several of them. I already waited and tried again. Give it a minute and ask once more.",
      });
    }
    /* Say what actually failed. The previous version returned a bare
       "Internal error", which is how a wrong model name managed to look like
       a merely unhelpful assistant for weeks instead of a broken one. */
    const detail = err instanceof Error ? err.message : String(err);
    console.error("ai-assistant function error:", detail);
    return jsonResponse({ error: "AI service error", detail: detail.slice(0, 500) }, 502);
  }

  if (!finalText) {
    return jsonResponse({
      reply: ranOutOfTime
        ? "That one took me longer than I'm allowed — I was still looking things up when I ran out of time. Try asking it in a smaller piece, like your standing first and then the target."
        : "I wasn't able to work out an answer to that — could you try rephrasing, or ask something more specific?",
    });
  }

  return jsonResponse({ reply: finalText });
});
