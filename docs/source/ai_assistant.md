---
kicker: Feature Guide  ·  the AI Assistant
title: The AI Assistant
subtitle: How it is built and how it works, end to end
intro: Everything about the one feature: what a student sees, what happens in the browser, what happens on the server, how it is stopped from making things up, and how to change it. Written to be read from start to finish by someone who has never seen the code.
updated: Updated 30 October 2026  ·  describes the feature/UI branch on that date  ·  first written 10 September 2026
footer: PES Study Guide
---

# 1. What it is

The AI Assistant is a chat page inside PES. A student types a question in ordinary English and gets an answer about their own degree — their marks, their standing, what they need for a target class, what the Faculty Handbook says, whether their attendance is in trouble.

It is not a search box with a friendly wrapper. It reads the student's actual records and writes a fresh answer each time. Since 30 September 2026 it also reads the faculty website, so it can answer about departments, staff, notices and facilities that the Handbook does not cover; since 2 October 2026 it can run on a model the faculty hosts itself.

## 1.1 What a student can ask

<!-- widths: 34,66 -->
| They type | It answers from |
|---|---|
| How am I doing so far? | Their real CGPA, credits and classification, plus anything the system has noticed. |
| What do I need for First Class from here? | Their standing, the target calculation, and the Handbook rule with a page number. |
| What courses do I need for the Data Management minor? | The three courses that make up that minor and which they have passed. |
| Is my attendance okay? | Their percentage per course against the 80% rule. |
| What happens if I fail a course? | The Faculty Handbook, quoted and cited. |
| Do I still owe any modules? | Any module carrying an R, F or L grade. |
| What did I get in CO3554? | That one published result. |
| What about semester 5? | The previous question, re-answered for semester 5. |

:::why THE ONE PROMISE IT MAKES
Every number it says out loud came from the database. It is not allowed to estimate, round, or work out a GPA in its head. If it does not know, it says so. Section 9 explains how that is enforced rather than merely requested.
:::

# 2. The story — and why it matters

This feature was rebuilt in September 2026. Understanding what it was before is the fastest way to understand why it is shaped the way it is now.

## 2.1 What it used to be

The old design tried three things in order, cheapest first.

- A cascade of regular expressions looked for patterns: a number that might be a GPA, the word 'results', a semester number.
- If that found nothing, a small AI model running inside the browser sorted the message into one of six known question types.
- Only if both failed did the question reach a real language model.

Whatever the classifier recognised was answered from a sentence written by hand, with the real numbers dropped into the gaps. Something like this:

```
return `Here's the plan: to land a ${target} CGPA, you'll want to
        average around ${data.required_avg_sgpa} SGPA in each of
        your remaining semesters.`;
```

## 2.2 Why it felt canned

Because it was. A template cannot rephrase itself, cannot answer a follow-up, and cannot join two facts into one reply. Ask the same thing twice and you get the same sentence twice.

Worse, the earlier steps recognised most questions, so the language model at the back of the queue was almost never reached. The usage log shows 25 calls in total, ever.

## 2.3 And those 25 calls all failed

:::warn THE BUG UNDER THE BUG
The model name was hardcoded as "gemini-3.5-flash", which the API does not serve. Every single call returned 404. The function reported that as a bare "Internal error", the browser caught it and showed a fixed fallback reply, and so a completely dead feature looked merely unhelpful for weeks. Nothing anywhere said why.
:::

Two failures were stacked on top of each other, and the outer one hid the inner one. That is the single most useful lesson in this document: a feature that degrades quietly is harder to fix than one that breaks loudly.

## 2.4 What changed

The order was inverted. Every message now goes to the model, and the model decides for itself which database functions to call. The 652 lines of pattern matching and templates in the browser became 50.

<!-- widths: 31,34,35 -->
|  | Before | After |
|---|---|---|
| Who decides what the question means | Regular expressions, then a classifier | The language model |
| Who writes the answer | A hand-written template | The language model, from tool results |
| Questions it could handle | Six types | Anything its fourteen tools can answer |
| Follow-up questions | No | Yes |
| Browser code | 652 lines | 50 lines |
| Download on first use | 25 MB model | None |

# 3. The shape of it

There are two halves: a thin front end in the browser, and an Edge Function on the server where all the real work happens.

```
  BROWSER                                    SERVER
  ---------------------------------          -----------------------------
  AIAssistant.tsx                            ai-assistant Edge Function
    the chat page                                |
        |                                        +-- checks who is asking
        v                                        +-- checks usage limits
  chatbotEngine.ts                               |
    one function, no logic                       v
        |                                    a model, told about 14 tools
        |                                    (the faculty's own, then Gemini)
        v                                        |     ^
  llmAssistant.ts                                |     |
    calls the function                           v     |
        |                                    'call get_academic_standing'
        |  HTTPS + the student's token            |     |
        +--------------------------------->      v     |
                                             the database
                                             (row-level security applies)
        <---------------------------------        |
           the finished answer                    +--->+
```

## 3.1 Why the work is on the server

1. **The keys.** Gemini needs a secret key, and a faculty-hosted model may need one too. Anything in the browser can be read by anyone who opens developer tools, so a key must never go there.
1. **The rules.** The instructions telling the model what it may and may not say have to be somewhere a student cannot edit.
1. **The limits.** Usage counting is worthless if the thing being counted can change the counter.

> The front end is deliberately dumb. It knows how to show messages and how to call one function. Every decision lives on the server.

# 4. The front end

Three files, and one of them is almost empty.

<!-- widths: 37,9,55 -->
| File | Lines | Job |
|---|---|---|
| app/pages/AIAssistant.tsx | 368 | The chat page: message list, input box, suggested questions, capability cards. |
| lib/chatbotEngine.ts | 52 | Send a message, return the reply. Nothing else. |
| lib/llmAssistant.ts | 67 | Call the Edge Function and report what happened. |
| components/chat/ChatMarkdown.tsx | — | Renders the reply's markdown: tables, bold, lists. |

## 4.1 AIAssistant.tsx — the page

Holds the conversation in React state. Each message is an object with an id, a role of user or assistant, the text, and a timestamp.

When the student presses send, it does three things:

1. Takes a snapshot of the last eight messages. This is the conversation history, and it is what makes a follow-up like "what about semester 5?" work.
1. Adds the student's message to the list and shows a thinking indicator.
1. Calls getAssistantReply(message, history) and appends whatever comes back.

```
const history: ChatHistoryItem[] = messages.slice(-8).map((m) => ({
  role: m.role,
  content: m.content,
}));

const reply = await getAssistantReply(message, history);
```

> The snapshot is taken BEFORE the new message is added, because the new message is sent separately. Getting this wrong would send the question twice.

## 4.2 chatbotEngine.ts — the whole thing

This file used to be 652 lines. It is now this:

```
export async function getAssistantReply(
  message: string,
  history: ChatHistoryItem[] = [],
): Promise<string> {
  const result = await askLlmAssistant(message, history);
  if (result.ok) return result.reply;
  if (result.kind === "refused") return result.reply;
  return UNREACHABLE_REPLY;
}
```

The only thing left in it is one honest failure message. If the assistant cannot be reached, saying so is right; inventing an answer locally is the thing this rewrite exists to stop.

## 4.3 llmAssistant.ts — the call

Calls the Edge Function through the Supabase client, which attaches the signed-in student's token automatically.

```
const { data, error } = await supabase.functions.invoke("ai-assistant", {
  body: { message, history },
});
```

It returns a shaped result rather than a bare string, so the caller can tell the difference between kinds of failure:

<!-- widths: 40,60 -->
| Result | Means |
|---|---|
| { ok: true, reply } | A real answer. |
| { ok: false, kind: 'refused', reply } | Reached, but it declined, and said why itself. |
| { ok: false, kind: 'unreachable', detail } | Never got an answer: network, deploy, or server error. |

:::why WHY THIS SHAPE MATTERS
The previous version returned null for every kind of failure alike. That is precisely how a completely dead AI tier — which is what the wrong model name had made it — became indistinguishable from a question it merely could not answer. A failure that cannot be told apart from a refusal will be mistaken for one.
:::

# 5. The back end, step by step

Four files under supabase/functions/ai-assistant/, running on Deno: `index.ts` (515 lines: the request, the limits, the tool loop), `providers.ts` (674: the models), `prompts.ts` (241: the instructions and the tool descriptions) and `present.ts` (274: tables and sources written by code for a small model). Here is what happens to a single message, in order.

1. **Check a model is configured.** No local model and no Gemini key means no service. Fail immediately and say so.
1. **Check there is a token.** No Authorization header means no student, so nothing can be scoped to anybody.
1. **Read the request.** The message, and up to eight history turns. Anything malformed in the history is filtered out rather than trusted.
1. **Build two database clients.** One carrying the student's token, one with the service key. These are kept strictly apart — see section 10.
1. **Identify the student.** auth.getUser() turns the token into a real user id. An invalid token stops here.
1. **Check the usage limits.** Faculty-wide and per-student, both counted from ai_assistant_usage_log.
1. **Record this call.** One row, so the next request counts correctly.
1. **Fetch the student's first name.** Only so a greeting can use it. It is never reported back as a fact.
1. **Run the tool loop.** This is the heart of it, and section 6 covers it on its own.
1. **Return the answer.** Or, if something went wrong, a message that says what.

## 5.1 The two clients

```
// Everything the student asks about goes through this one.
const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: authHeader } },
});

// Only ever used for the usage log. Never for academic data.
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
```

:::why THIS SPLIT IS THE SECURITY MODEL
The user client carries the student's own token, so the database applies row-level security to everything it does — exactly as it would if the student had clicked a page. The admin client bypasses that, which is why it is allowed nowhere near a mark, a grade or a record. It counts rows in a usage table and nothing else.
:::

# 6. The tool loop

This is the mechanism that makes the whole thing work, and it is simpler than it sounds.

## 6.1 The idea

The model is not given the student's data. It is given a list of fourteen tools, each with a name and a description of what it returns. It then asks for the ones it needs.

A conversation with the model looks like this:

```
  us    : "What do I need for First Class?"  + here are your 14 tools
  model : please call get_academic_standing
  us    : here is what it returned: { cgpa: 3.61, credits: 100, ... }
  model : please call calculate_gpa_target with 3.70
  us    : here is what it returned: { required: 3.90, ceiling: 3.73 }
  model : "You need a 3.90 average across your remaining 44 credits.
           Your ceiling is 3.73, so there is very little room."
```

Each of those exchanges is a separate request to Gemini. The loop runs up to six times, then stops.

## 6.2 The code

```
for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
  if (Date.now() - startedAt > DEADLINE_MS) { ranOutOfTime = true; break; }

  const geminiData = await callGemini({ contents, tools: TOOLS, ... });
  const candidate  = geminiData.candidates?.[0];
  const parts      = candidate?.content?.parts ?? [];
  const calls      = parts.filter((p) => p.functionCall);

  if (calls.length > 0) {
    contents.push(candidate.content);        // the model's turn, verbatim
    const responses = [];
    for (const part of calls) {
      const { name, args } = part.functionCall;
      const result = await executeTool(name, args ?? {});
      responses.push({ functionResponse: { name, response: { result } } });
    }
    contents.push({ role: "user", parts: responses });
    continue;
  }

  finalText = parts.find((p) => typeof p.text === "string")?.text ?? null;
  break;
}
```

## 6.3 Two details that are easy to get wrong

### Push the model's turn back exactly as it came

Line 9 above pushes candidate.content — the object the model actually sent. An earlier version rebuilt it from the name and arguments instead:

```
// WRONG. Looks equivalent, is not.
contents.push({ role: "model", parts: [{ functionCall: { name, args } }] });
```

:::warn WHAT THAT COST
Gemini 3 attaches a hidden thought_signature to each function call and requires it back unchanged. Rebuilding the object dropped it, and the API refused the next request: "Function call is missing a thought_signature in functionCall parts." Every question that needed a tool failed with a 400. Only greetings worked, because greetings call no tools.
:::

### Answer every call in the turn, not just the first

The model can ask for two lookups at once. The loop iterates over all of them. An earlier version served only the first and silently discarded the rest, which left the model reasoning from half the data it had asked for.

> Asking for two tools in one turn is also cheaper: each turn is a separate request against a tight rate limit, so batching two into one is the difference between an answer and a refusal. The model is explicitly told this in its instructions.

# 7. The fourteen tools

Every tool is a PostgreSQL function called through the student's own token. None of them takes a student id — they all resolve the caller from auth.uid(), so a student cannot ask about anyone else even if they try.

## 7.1 The student's own record

<!-- widths: 37,63 -->
| Tool | Returns |
|---|---|
| get_academic_standing | CGPA, credits completed and remaining, current semester, classification. |
| calculate_gpa_target | The average SGPA needed for a target CGPA, whether it is still possible, and the ceiling. |
| get_student_results | Published results, optionally filtered by semester or course. |
| get_student_course_result | The grade for one named course. |
| get_my_attendance | Overall and per-course attendance against the 80% rule. |
| my_outstanding_modules | Modules still owed on an R, F or L grade. |
| get_my_medical_submissions | Each certificate and the decision on each module. |
| get_my_minor_progress | Which minors exist, what they need, which courses count, what is passed. |
| get_my_insights | Everything the system has noticed: attendance risk, GPA decline, deadlines. |

## 7.2 The curriculum

<!-- widths: 37,63 -->
| Tool | Returns |
|---|---|
| get_upcoming_courses | The student's own next semester, from their actual progress. |
| get_courses_by_semester | Any named semester, regardless of where the student is. |
| get_course_info | Catalogue details for one module: credits, category, semester. |

## 7.3 The Handbook

<!-- widths: 37,63 -->
| Tool | Returns |
|---|---|
| search_handbook | Passages from the Faculty Handbook 2026, with section and page. |

## 7.4 The faculty website

<!-- widths: 37,63 -->
| Tool | Returns |
|---|---|
| search_faculty_website | Sections of eng.sjp.ac.lk — departments, programmes, staff, news, notices, facilities, contacts — each with its title and address, so the answer can link to the page. |

The website is not browsed while a student waits. The `faculty-site-sync` Edge Function reads it ahead of time — every night at 02:07, and whenever the super admin presses Refresh on the dashboard — into `faculty_site_pages` (what was found and when) and `faculty_site_chunks` (what is searched). It follows robots.txt, stays on the faculty's own host, reads a few pages at a time, and rewrites a page only when its text has changed. The search ranks a section first by how many of the question's words it contains, then by full-text rank. The suggested questions on the empty chat page include website questions, so students discover it.

## 7.5 How a tool is described

The description is the only thing the model has to go on, so it is written for the model rather than for a developer. It says what the tool returns, when to use it, and — importantly — when not to.

```
{
  name: "get_student_results",
  description:
    "Get the calling student's REAL published results ... This is the
     ONLY correct source for 'my results' questions — never use
     search_handbook or get_courses_by_semester for this, those return
     curriculum data, not the student's actual grades.",
  parameters: { ... },
}
```

> The capital letters are deliberate. So is naming the wrong tools explicitly: telling a model what not to reach for is more effective than hoping it will not.

# 8. The Faculty Handbook knowledge base

Regulations are not in the database as rows. They are in a 96-page PDF. To let the assistant quote them, the Handbook is cut into pieces, each stored with a searchable index.

## 8.1 The numbers

<!-- widths: 29,71 -->
|  |  |
|---|---|
| Source | Faculty Handbook 2026, 96 pages, about 102,000 characters |
| Pieces stored | 131 |
| Sections covered | 83 |
| Average piece | about 596 characters |
| Pages covered | 8 to 96 |
| Stored in | the handbook_chunks table |

## 8.2 The pipeline

1. **Extract.** extract_handbook.py reads the PDF and finds headings from the document's own typography — body text is 11–12pt, every heading is bold or 14pt and above.
1. **Chunk.** chunk_and_embed_v2.mjs groups the text by section and cuts it into overlapping pieces of about 150 words.
1. **Embed.** Each piece is turned into a list of 384 numbers by a small model, so that similar meanings sit close together.
1. **Load.** reload_chunks_v2.mjs writes them into the database, backing up what was there first.

### Three things the first version got wrong

<!-- widths: 29,35,36 -->
| Problem | Effect | Fix |
|---|---|---|
| Headings guessed from text shape | 96 pages collapsed into 8 sections | Read the PDF's fonts instead — found 140 |
| Chunks did not overlap | A rule split across a boundary was lost from both halves | Each chunk repeats the last 40 words of the one before |
| Half the Handbook dropped | Whole sections unanswerable | Only staff lists and ceremonial pages are dropped now |

:::why WHY THE HEADING IS STORED WITH THE BODY
The paragraph that defines the Dean's List never contains the words "Dean's List" — its heading does. Embedding the heading together with the text is what lets a question about the Dean's List find the paragraph that answers it.
:::

## 8.3 Hybrid search

The assistant's handbook tool calls search_handbook_hybrid, which searches two ways at once and merges the results.

<!-- widths: 22,38,40 -->
| Half | How it works | Good at |
|---|---|---|
| Word matching | Finds pieces sharing words with the question | Exact terms: a course code, a specific name |
| Vector similarity | Finds pieces that mean something similar | Questions phrased nothing like the document |

The two rankings are merged by reciprocal rank fusion — a piece scores 1/(60+rank) in each list, and the scores are added. A piece that both halves rank highly wins.

### Why this replaced the old search

The previous search required every word of the question to appear. A student asks "What happens if I fail a course?" and the passage that answers it is headed "Repeating a Course" and shares almost none of those words. Measured against 18 real questions:

<!-- widths: 31,35,34 -->
| Method | Found the right passage | Returned nothing at all |
|---|---|---|
| Old keyword search | 3 of 18 | 15 |
| Vector only | 17 of 18 | 0 |
| Hybrid | 18 of 18 | 0 |

:::warn A BUG WORTH KNOWING ABOUT
The first hybrid version stemmed the query twice. Words are reduced to stems before storage — "degree" becomes "degre" — and feeding those stems back through the stemmer turned "degre" into "degr", which matched nothing. Twenty-five chunks contained the word degree and a search for it returned none of them. The fix was one word: search the stems with the 'simple' configuration, which leaves them alone.
:::

# 9. How it is stopped from making things up

A language model will happily produce a confident, plausible, wrong number. Four things prevent that here.

## 9.1 It may only say what a tool returned

The system instruction opens with this, and the wording is deliberately absolute:

```
- State ONLY facts that came back from a tool call in this
  conversation. Never estimate, infer, or round a number a tool
  did not return.
- If a tool errors or returns nothing, say so plainly. Do not fill
  the gap with something plausible.
```

## 9.2 It is forbidden from doing arithmetic

```
- Never do GPA or CGPA arithmetic yourself, however simple it looks.
  Call calculate_gpa_target or get_academic_standing and report what
  they return. There is one source of truth for that maths and it is
  not you.
```

This matters more than it appears. The Graduation Planner uses the same functions, so a student who checks the assistant against the planner sees the same numbers. If the model were allowed to compute, there would be two answers and no way to tell which was right.

## 9.3 Personal questions have designated tools

The instruction names which tools answer personal questions and forbids the curriculum and Handbook tools from being used for them — because a curriculum listing looks enough like a results table to be mistaken for one.

## 9.4 It is told what it cannot see

```
## What you cannot do yet

You cannot see course feedback, and you cannot tell whether an
enrolment window is currently open. You also cannot change anything:
you read records, you never submit, enrol or withdraw.

For those, say plainly that you cannot see it and name the page that
can. Do not guess, and never use the handbook as a substitute for a
record you cannot read.
```

> Naming the gaps is what turns a confident wrong answer into an honest "I cannot see that, try the Enrollment page".

## 9.5 One rule about tone, for a reason

A late addition, after a real answer overstated a student's chances:

```
- Do not oversell a tight one. "Feasible" from a tool means
  arithmetically possible, not likely. If the required average is
  close to the maximum, say plainly how little room there is.
  A student who relaxes because you sounded confident is worse off
  than one you were honest with.
```

The numbers had all been correct: 3.61 now, a 3.90 average required, a ceiling of 3.73 against a 3.70 target. The assistant called that "definitely reachable". It is arithmetically true and practically misleading — a margin of 0.03 needing near-perfect grades for two years.

# 10. Security

The assistant reads real academic records, so this section matters more than any other.

## 10.1 A student cannot ask about anyone else

Not because the model is well behaved, but because it is impossible.

1. The browser sends the student's own signed token.
1. The Edge Function builds a database client carrying that token.
1. Every tool call goes through that client.
1. PostgreSQL applies row-level security to every query, as the student.
1. No tool takes a student id as a parameter. They all resolve the caller from auth.uid() inside the database.

:::why WHAT THIS MEANS IN PRACTICE
If the model were somehow persuaded to ask for another student's marks, there is no way to express the request — the tools have no parameter for it — and if there were, the database would return nothing. The protection is structural, not behavioural.
:::

## 10.2 The key never reaches the browser

GEMINI_API_KEY is an Edge Function secret, set in the Supabase dashboard under Project Settings → Edge Functions → Secrets. It is not in the repository, not in .env.local, and has never been committed. The function reads it at runtime with Deno.env.get.

## 10.3 The health check is locked to operators

There is a diagnostic mode that reports which model is working and what prompt is deployed. It is gated on the caller's role, read from the already-verified token:

```
if (jwtRole(authHeader) !== "service_role") {
  return jsonResponse({ error: "Unauthorized" }, 401);
}
```

> An earlier version compared the token against the service key directly and rejected its own author, because the platform injects that key in a different format than an operator holds. Reading the role claim is both simpler and correct.

## 10.4 A lesson from a real bug

Two tools were originally written to run as the caller rather than with elevated rights. Students have no direct read permission on the results table — deliberately, because marks are read through functions that enforce the "not until published" rule. So both tools counted zero results, for every student, always.

<!-- widths: 44,56 -->
| For a real student with 53 published results | Said |
|---|---|
| get_academic_standing | CGPA 2.89, 125 credits done, next semester 7 |
| calculate_gpa_target | CGPA 0.00, 0 credits done, 144 remaining |
| get_upcoming_courses | next semester 1 |

:::warn THIS WAS NOT ONLY AN ASSISTANT BUG
The Graduation Planner calls the same functions. A student six semesters in had been told they needed a 3.70 average across all 144 credits starting from nothing. Both functions now run with elevated rights — safe, because each one filters every read on auth.uid(), so it can only ever see the caller's own marks.
:::

# 11. Limits and failures

## 11.1 Which model answers

`providers.ts` puts every model behind one interface and the function tries them in order. There are two kinds:

- **A model the faculty runs itself** — Qwen, Llama or similar, served by Ollama, llama.cpp or vLLM on a faculty machine. All three speak the same OpenAI-compatible chat API, so one adapter covers them. It has no per-minute or per-day allowance; its only limit is the machine. Qwen 2.5 3B answers typical questions in 2 to 30 seconds on an ordinary 4-core CPU with 8 GB of memory and no graphics card. Student records also stay inside the faculty.
- **Google Gemini**, with one or more API keys. Each key is a provider of its own, so a key that is out of allowance, revoked or mistyped is stepped past rather than taking the assistant down.

<!-- widths: 30,70 -->
| Secret | What it sets |
|---|---|
| LOCAL_LLM_URL | The faculty model's address. Leave it unset and only Gemini is used. |
| LOCAL_LLM_MODEL | Its name, e.g. qwen2.5:3b (the default). |
| LOCAL_LLM_API_KEY | A key for it, if the server asks for one. |
| LOCAL_LLM_PROFILE | small (default): shorter instructions and tool descriptions, a hint naming the likely lookup, and lists written by code; full for a 7B model or larger on a GPU. |
| GEMINI_API_KEYS | A comma-separated list of keys. GEMINI_API_KEY still works on its own. |
| AI_PROVIDERS | The order: local,gemini (default), gemini,local, or local alone. |
| GEMINI_MODEL | Overrides the Gemini model name (section 11.4). |

A provider that cannot serve right now — rate limited, overloaded, unreachable, or with a full queue — throws `Unavailable`, and the next one is tried. Anything else is a real error and is reported. `docs/local-llm.md` walks through setting up the faculty machine, with measured timings.

:::warn THE CONSTRAINT THAT USED TO DECIDE EVERYTHING
On Gemini's free tier the assistant could answer only about five questions a day for the whole faculty: twenty requests per model per day, and one question costs three or four. Several keys help a little; a paid key or the faculty's own model removes the ceiling. Neither needs a code change — only secrets.
:::

## 11.2 Our own limits, and why they are not the problem

There are two caps of our own, both configurable so they can be tightened for release without a deploy:

<!-- widths: 31,18,51 -->
| Setting | Default | Purpose |
|---|---|---|
| AI_DAILY_QUOTA | 5000 | Faculty-wide ceiling |
| AI_PER_STUDENT_DAILY | 1000 | One student's ceiling |

These are deliberately high. During development the only user is the developer, and caps sized for a faculty were getting in the way of the one person who needed to try it. What they still guard against is a runaway loop — a retry that never stops, or a client bug sending the same question a thousand times — which does not care how many users there are.

## 11.3 What happens when something fails

<!-- widths: 27,73 -->
| Failure | Response |
|---|---|
| Rate limited (429) | Wait 21 seconds and retry, up to twice, then try another model, then say plainly it is rate limited. |
| Model overloaded (503) | Wait 4 seconds and retry. An overloaded model clears in seconds; waiting a full rate-limit window would waste the deadline. |
| Model not found (404) | Log the name loudly and try the next candidate. |
| Taking too long | Stop at 60 seconds and say so, rather than be killed with nothing to show. |
| Anything else | Return the actual error text, not a bare "Internal error". |

### Why 503 is retried at all

Because the API asks to be. Its own message reads: "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later." Treating that as a hard failure turned a momentary spike into a visible "I can't reach the assistant" for the student.

## 11.4 The model name is no longer hardcoded

```
const MODEL_CANDIDATES = [
  Deno.env.get("GEMINI_MODEL"),   // an override, if set
  "gemini-3.6-flash",             // confirmed live
].filter(Boolean);
```

The first candidate that actually answers is used and remembered. A model that is not found is logged by name and skipped. Setting a GEMINI_MODEL secret changes the model without touching code.

> gemini-2.5-flash was removed from this list. The API answers "no longer available to new users", so it was never a fallback — every attempt spent a round trip on a guaranteed 404 and filled the log with a failure that was not the real one.

## 11.5 The deadline

The platform kills a worker that runs too long, and a killed worker never reaches an error handler — the caller gets WORKER_RESOURCE_LIMIT and the logs say nothing. So the function stops itself first, at 60 seconds, while it still has time to say something.

This was written after a real 150-second hang, caused by the two disagreeing tools in section 10.4: the model kept calling them, trying to reconcile answers that could not be reconciled, until the platform cut it off.

# 12. How to check it yourself

## 12.1 Is the server healthy?

A service-role request with { "diagnose": true } reports the live state without needing a student account:

```
{
  "candidates": ["gemini-3.6-flash"],
  "tools": [ ...fourteen names... ],
  "max_tool_turns": 6,
  "per_student_daily": 1000,
  "prompt_sha256_16": "98546f460087ea80",
  "working_model": "gemini-3.6-flash",
  "reply": "ok",
  "handbook_chunks": 131
}
```

The prompt hash is there because deploys currently send the source inline rather than from a file. Comparing that hash against the repository proves the deployed instructions are the ones that were written.

## 12.2 Is the Handbook search any good?

benchmark_retrieval.mjs runs eighteen real student questions and reports, for each, whether the correct passage came back — by vector search, by word search, and by hybrid. Run it before and after any change to the chunks or the search.

## 12.3 Is a tool returning the right thing?

Any tool can be checked directly in SQL, as any student, without touching production:

```
begin;
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"<the student id>","role":"authenticated"}';

select jsonb_pretty(public.get_my_insights());

rollback;   -- nothing was changed
```

:::why TEST THE PATHS THAT HAVE NO DATA
Attendance has six rows in the whole system, so no real student triggers an attendance warning. The way to test it is to insert rows inside that transaction, check the result, and roll back. Everything above was verified that way.
:::

# 13. How to add a new tool

Five steps. Adding a feedback tool would look exactly like this.

1. **Write the database function.** SECURITY DEFINER, with SET search_path, resolving the student from auth.uid() and filtering every read on it. Return one JSON object holding everything about the subject.
1. **Grant it.** revoke from public and anon, grant to authenticated and service_role.
1. **Test it in SQL** with the transaction recipe above, as a real student, before any code touches it.
1. **Declare it to the model.** Add an entry to TOOLS with a description written for the model: what it returns, when to use it, when not to.
1. **Wire it up.** Add a case to executeTool that calls the function through userClient.

### Two rules that are not optional

1. **SECURITY DEFINER, always.** The two tools that were left as INVOKER silently returned zero for every student for weeks. If the function reads results or any table a student cannot read directly, it must be definer — and it must filter on auth.uid() so that is safe.
1. **Make the tool coarse.** One call that answers a whole question beats three that need three turns. Every turn is a request against a twenty-a-day budget.

## 13.1 Changing what it says

Tone and rules live in SYSTEM_INSTRUCTION in the same file, in four sections: Grounding, Reaching for tools, What you cannot do yet, and Voice. Changing behaviour usually means adding one line there rather than writing code.

> After any change, redeploy and compare the prompt hash from the health check against the repository. They should match.

# 14. What it still cannot do

<!-- widths: 29,42,29 -->
| Gap | Why | Difficulty |
|---|---|---|
| Course feedback | No tool written yet | Small — the RPCs exist |
| Whether enrolment is open right now | It knows what is owed, not what is open today | Small |
| Changing anything | Deliberate. It reads; it never enrols, submits or withdraws. | By design |
| Attendance warnings for real students | Only a handful of attendance rows exist in the whole system | Not a code problem |
| Pages outside eng.sjp.ac.lk | Deliberate: the website reader stays on the faculty's own host | By design |
| Predicting results | Not part of the design. The assistant is tool calling plus retrieval over the Handbook (RAG), not a trained model | Out of scope |

:::warn THE LAST ONE IS WORTH UNDERSTANDING
The March project proposal described a CART decision-tree model predicting exam outcomes from mid-semester marks, CA marks and attendance. The design changed: the assistant was built as a language model that calls the database for facts and retrieves Handbook passages for rules (RAG), and there is no trained prediction model, nor one planned. That was also the practical choice — all 7,392 result rows carry a grade and nothing else, because the historical results were imported as letter grades, so there were no marks to train on.
:::

# 15. Quick reference

<!-- widths: 38,62 -->
| To understand... | Read |
|---|---|
| What the student sees | pes_app/src/app/pages/AIAssistant.tsx |
| How the browser calls the server | pes_app/src/lib/llmAssistant.ts |
| Everything the assistant actually does | supabase/functions/ai-assistant/index.ts |
| What it is allowed to say | SYSTEM_INSTRUCTION, in prompts.ts |
| Which models it can use | supabase/functions/ai-assistant/providers.ts, and docs/local-llm.md |
| The instructions and the tool descriptions | supabase/functions/ai-assistant/prompts.ts |
| How the faculty website is read | supabase/functions/faculty-site-sync/ |
| How the Handbook was prepared | pes-scripts/rag/extract_handbook.py and chunk_and_embed_v2.mjs |
| Whether the search works | pes-scripts/rag/benchmark_retrieval.mjs |
| Why a function looks the way it does | supabase/migrations/, read in date order |

## 15.1 The tools and the functions behind them

<!-- widths: 40,60 -->
| Tool name | Database function |
|---|---|
| get_academic_standing | get_academic_standing() |
| calculate_gpa_target | calculate_gpa_target(numeric) |
| get_student_results | get_student_results(int, text) |
| get_student_course_result | get_student_course_result(text) |
| get_my_attendance | get_my_attendance() |
| get_my_minor_progress | get_my_minor_progress() |
| my_outstanding_modules | my_outstanding_modules() |
| get_my_medical_submissions | get_my_medical_submissions() |
| get_my_insights | get_my_insights() |
| get_upcoming_courses | get_upcoming_courses() |
| get_courses_by_semester | get_courses_by_semester(int) |
| get_course_info | get_course_info(text) |
| search_handbook | search_handbook_hybrid(text, vector, int) |
| search_faculty_website | search_faculty_site(text, int) |

> Fourteen tools, each with the database function behind it. Two names differ: search_faculty_website runs search_faculty_site, and search_handbook is the tool name the model sees, and search_handbook_hybrid is the function it runs. The name was kept stable when the search was replaced so the model's instructions did not have to change. The vector type in that signature lives in the extensions schema since 27 September 2026, which is why the handbook functions carry extensions on their search_path.
