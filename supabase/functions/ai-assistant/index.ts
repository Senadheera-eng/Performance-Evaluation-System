// PES AI Assistant — LLM escalation tier.
//
// This is ONLY called when the client-side rule-based engine (chatbotEngine.ts)
// doesn't recognize the intent AND the free client-side handbook vector
// search (search_handbook) doesn't find a confident match either. Everything
// that already works — GPA targets, current standing, upcoming courses,
// course lookups, and most handbook questions — stays on the fast, free,
// zero-latency path and never reaches this function. This tier exists for
// the long tail: genuinely novel questions the deterministic paths can't
// answer, where an LLM composing an answer from real tool results does
// better than a flat "I didn't catch that."
//
// Grounding contract: the model is only allowed to state facts that came
// back from a tool call. It never computes GPA/CGPA itself — that's always
// delegated to calculate_gpa_target / get_academic_standing, the same RPCs
// the rest of the app uses, so there is exactly one source of truth for
// that math, not two.
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Gemini's free tier caps at 1,500 requests/day for the whole project —
// this is a shared resource across every student, so refuse gracefully
// well before hitting that wall rather than letting one heavy user (or a
// bug in a retry loop) exhaust everyone else's quota for the day.
const DAILY_QUOTA = 1400;
const MODEL = "gemini-3.5-flash";
const MAX_TOOL_TURNS = 4;

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
        name: "search_handbook",
        description:
          "Full-text search over the Faculty Handbook 2026 for policies, regulations, grading rules, degree/graduation requirements, minors, industrial training, medical excuse policy, etc. This is literal keyword search, not semantic — if a search returns nothing, try again with different, simpler wording (e.g. the exact terms a policy document would use) before giving up.",
        parameters: {
          type: "OBJECT",
          properties: {
            p_search: { type: "STRING", description: "Search terms" },
          },
          required: ["p_search"],
        },
      },
    ],
  },
];

const SYSTEM_INSTRUCTION = `You are the PES academic assistant for Faculty of Engineering students at the University of Sri Jayewardenepura.

STRICT RULES — these override any instinct to be more "helpful":
- You may ONLY state facts that appear in the tool results you receive in this conversation. Never estimate, infer, or round a number that a tool didn't actually return.
- Never perform GPA/CGPA arithmetic yourself, even simple-looking arithmetic — always call calculate_gpa_target or get_academic_standing and report exactly what they return.
- If a tool returns an error or no data, say so plainly rather than guessing or making up a plausible-sounding answer.
- When you use search_handbook, cite the section name and page number from the result in your answer. If your first search finds nothing, try again with different/simpler keywords before concluding there's no answer.
- If none of your tools return anything relevant to the question after reasonable attempts, say plainly that you don't have enough information, and suggest the student check with their department — do not fabricate an answer.
- For personal data (results, grades, GPA, attendance, enrollment), use ONLY get_student_results / get_student_course_result / get_academic_standing / calculate_gpa_target — NEVER search_handbook or get_courses_by_semester, which are curriculum/policy documents, not the student's actual records. If get_student_results returns no rows for a requested semester, say plainly that no results were found for that semester — do not substitute results from a different semester, and do not describe that semester's curriculum from the handbook as if it were an answer to a results question.
- Keep answers concise and conversational, like a knowledgeable senior student texting back — not a formal report.
- If the student sends a greeting or casual small talk (hi, hello, good morning, thanks, how's it going, etc.) with no real question attached, do NOT call any tools and do NOT dump your full capability list — just reply briefly and warmly in 1-2 sentences, vary your wording instead of reusing the same greeting every time, use their first name if you know it, and naturally invite them to ask about their studies. Pick up any earlier conversation naturally rather than treating each message as the first one.
- Format your answers in markdown when it aids readability: short paragraphs, headings for distinct sections, bullet or numbered lists for steps or grouped facts, and **bold** for key numbers or terms. Don't over-format a one-line answer or a greeting.`;

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
  let history: { role: "user" | "assistant"; content: string }[] = [];
  try {
    const body = await req.json();
    message = body.message;
    if (!message || typeof message !== "string") throw new Error("bad message");
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
        "The AI assistant has hit its shared daily usage limit for today — please try again tomorrow, or ask about your GPA target, current standing, upcoming courses, or a specific course, which I can still answer instantly.",
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
      case "search_handbook": {
        const { data, error } = await userClient.rpc("search_handbook_text", {
          p_search: args.p_search,
          p_limit: 3,
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

  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents,
            tools: TOOLS,
            systemInstruction: { parts: [{ text: systemInstructionText }] },
            // Greetings/small talk benefit from a little more natural
            // variation than the grounded-answer default; the model still
            // can't invent facts since tool results are unaffected by this.
            generationConfig: { temperature: 0.4 },
          }),
        },
      );

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        console.error("Gemini API error:", geminiRes.status, errText);
        return jsonResponse(
          { error: "AI service error", detail: errText.slice(0, 500) },
          502,
        );
      }

      const geminiData = await geminiRes.json();
      const candidate = geminiData.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];

      // deno-lint-ignore no-explicit-any
      const functionCallPart = parts.find((p: any) => p.functionCall);

      if (functionCallPart) {
        const { name, args } = functionCallPart.functionCall;
        const result = await executeTool(name, args ?? {});

        contents.push({ role: "model", parts: [{ functionCall: { name, args } }] });
        contents.push({
          role: "user",
          parts: [{ functionResponse: { name, response: { result } } }],
        });
        continue;
      }

      // deno-lint-ignore no-explicit-any
      const textPart = parts.find((p: any) => typeof p.text === "string");
      finalText = textPart?.text ?? null;
      break;
    }
  } catch (err) {
    console.error("ai-assistant function error:", err);
    return jsonResponse({ error: "Internal error" }, 500);
  }

  if (!finalText) {
    return jsonResponse({
      reply:
        "I wasn't able to work out an answer to that — could you try rephrasing, or ask something more specific?",
    });
  }

  return jsonResponse({ reply: finalText });
});
