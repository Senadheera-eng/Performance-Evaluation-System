---
kicker: How the PES AI Assistant Works
title: RAG and the 14 tools, explained in simple English
subtitle: 
intro: Faculty of Engineering, University of Sri Jayewardenepura
updated: Updated 30 October 2026  ·  describes the feature/UI branch on that date  ·  first written 27 September 2026
footer: PES Study Guide
---

# 1. The short version

The AI Assistant is a chat page where a student asks questions in ordinary English — "How am I doing?", "What do I need for First Class?", "What happens if I fail a course?" — and gets an answer about **their own record**, about **the Faculty Handbook**, and about **the faculty website**.

It is built from two ideas working together:

- **RAG (Retrieval-Augmented Generation)** — for rules, regulations and faculty information. Before answering, the assistant looks up the relevant pages of the Faculty Handbook or the faculty website and answers from them, with a page number or a link.
- **Tools** — for the student's personal data. The assistant can ask the database twelve specific questions ("what is this student's CGPA?", "what is their attendance?") and answers from what comes back.

In fact both searches are tools too. So the simplest accurate description is: **a language model with 14 tools, two of which are RAG searches — one over the Faculty Handbook, one over the faculty website.**

```
  Student question
        |
        v
  AI model           --- "I need facts" --->  14 tools
  (faculty's own,                                 |
   or Gemini)         12 read the student's record and the catalogue
        ^              1 searches the Faculty Handbook (RAG)
        |              1 searches the faculty website (RAG)
        +------------- facts come back -----------+
        |
        v
  Answer written only from those facts
```

# 2. What is RAG?

## 2.1 The problem RAG solves

A large language model (LLM) such as Gemini has read a huge amount of text from the internet. It writes fluent, confident English. But it has never read **our** Faculty Handbook, and it has no idea what grade a particular student got in CO3554.

If you simply ask a plain LLM "What is the minimum attendance at USJ Engineering?", it will give an answer that sounds right — and it may be wrong, because it is guessing from what other universities do. This is called **hallucination**: a fluent answer that is not grounded in real facts.

## 2.2 The idea: an open-book exam

RAG turns a closed-book exam into an open-book exam. Instead of answering from memory, the model is first handed the relevant pages, and then asked to answer **using those pages**.

The name describes the three steps:

<!-- widths: 24,76 -->
| Step | What happens |
|---|---|
| **R**etrieve | Search a collection of documents and find the few passages most related to the question. |
| **A**ugment | Add those passages to the model's input, next to the question. |
| **G**enerate | The model writes the answer, and is told to rely on the passages, not on its memory. |

> **A SIMPLE WAY TO REMEMBER IT**

> RAG = "look it up first, then answer". The model supplies the language; the documents supply the facts.

## 2.3 Why not just give the model the whole Handbook?

The Handbook is 96 pages (about 102,000 characters). Sending all of it with every question would be slow and expensive, and a model given too much text is worse at finding the one sentence that matters. RAG sends only the four most relevant passages — a few hundred words.

# 3. Building the Handbook knowledge base

Before any question can be answered, the Handbook has to be prepared once. This is done by scripts in pes-scripts/rag/ and the result is stored in the database table **handbook_chunks**.

1. **Extract.** extract_handbook.py reads the PDF and finds the section headings from the document's own typography: body text is 11–12 pt, and every heading is bold or 14 pt and above. This found 140 headings. An earlier version guessed headings from the shape of the text and collapsed all 96 pages into just 8 sections.
1. **Chunk.** chunk_and_embed_v2.mjs cuts each section into pieces of about **150 words** (never more than 230). Each piece **overlaps** the previous one by **40 words**, so a rule that falls across a cut still appears whole in one of the two pieces.
1. **Keep the heading with the text.** The paragraph that defines the Dean's List never contains the words "Dean's List" — only its heading does. So every chunk is stored together with its section heading and page number.
1. **Embed.** Each chunk is turned into an **embedding**: a list of 384 numbers that describes its meaning. This uses a small free model, all-MiniLM-L6-v2, which runs on the developer's computer, so it costs nothing and needs no API key.
1. **Store.** reload_chunks_v2.mjs loads the result into handbook_chunks: **131 chunks** covering 83 sections, pages 8 to 96. Staff lists and ceremonial pages are left out; every page with academic rules is kept.

## 3.1 What an embedding is, simply

Think of each chunk as a point on a map of meanings. Chunks about similar things sit close together: "repeating a course" and "failing a module" end up near each other even though they share almost no words. A question is placed on the same map, and the nearest chunks are the most related ones. The 384 numbers are just the coordinates of that point.

## 3.2 Two indexes on the same table

<!-- widths: 29,36,36 -->
| Index | What it stores | Good at finding |
|---|---|---|
| Full-text index (tsv) | The words of each chunk and its heading, reduced to their stems ("repeating" → "repeat") | Exact terms: a course code, a named rule, "Dean's List" |
| Vector index (HNSW on embedding) | The 384-number meaning of each chunk | Questions phrased nothing like the Handbook |

# 4. How the Handbook is searched

The search function in the database is **search_handbook_hybrid**. "Hybrid" means it can search both ways at once and merge the two rankings.

1. **Word matching.** The question's words are stemmed and joined with OR, so a chunk needs only some of the words, not all of them. Chunks are ranked by how well they match.
1. **Meaning matching.** If an embedding of the question is supplied, chunks are also ranked by how close they are on the meaning map.
1. **Merge.** The two rankings are combined by **reciprocal rank fusion**: each chunk scores 1 / (60 + its rank) in each list, and the scores are added. A chunk that both methods rank highly wins.
1. **Return the top 4**, each with its text, section heading and page number.

## 4.1 Why this design — the measurements

Eighteen real student questions were run against the Handbook (pes-scripts/rag/benchmark_retrieval.mjs). For each one, did the search return the passage that actually answers it?

<!-- widths: 40,30,30 -->
| Method | Found the right passage | Returned nothing |
|---|---|---|
| Old keyword search (every word required) | 3 of 18 | 15 of 18 |
| Meaning (vector) only | 17 of 18 | 0 |
| Hybrid (words ORed + meaning) | 18 of 18 | 0 |

The old search required every word of the question to appear in the passage. "What happens if I fail a course?" is answered by a section headed "Repeating a Course", which shares almost none of those words — so the old search found nothing, and the model was told the Handbook had no answer when it plainly did.

> **HOW THE LIVE ASSISTANT USES IT TODAY**

> The assistant calls search_handbook_hybrid with the question text only, without an embedding. Measured on the same 18 questions, the word-matching half on its own already returns the right passage for all 18, so running an embedding model on the server for every question would add cost and delay for no gain.

> The vector half and its index are built and ready. If a future question type needs meaning matching, the assistant only has to start sending an embedding.

# 5. RAG is only half the answer: the tools

RAG is perfect for the Handbook, because the Handbook is a fixed document. It is the wrong tool for a student's own record:

- A student's marks, attendance and enrolments **change every day**. Documents would have to be rebuilt constantly.
- Turning 167 students' records into searchable text would put **everyone's data in one pile**, where a search might return another student's marks.
- Numbers like a CGPA must be **exact**. A passage that is "similar" to the right answer is not good enough.

So personal questions are answered with **tool calling** (also called function calling). The model is given a menu of tools, each with a name and a description. When it needs a fact, it replies "please run get_my_attendance" instead of answering. The server runs that database function and hands the result back. The model can ask for several tools, over several turns, before it writes its answer.

> **THE KEY DIFFERENCE**

> RAG finds text that is **probably relevant**. A tool returns a fact that is **exactly right**. PES uses RAG for the rules and tools for the record.

# 6. The 14 tools

Every tool is a PostgreSQL function. None of them takes a student id: each works out who is asking from the signed-in student's own token, so a student can only ever get their own data.

## 6.1 The student's own record — 8 tools

<!-- widths: 30,40,30 -->
| Tool | What it returns | Example question |
|---|---|---|
| get_academic_standing | CGPA, credits completed and remaining, current semester and class of degree | How am I doing so far? |
| calculate_gpa_target | The average SGPA needed for a target CGPA, whether it is still possible, and the highest CGPA still reachable | What do I need for First Class? |
| get_student_results | Published results, optionally for one semester or one course | Show my semester 5 results. |
| get_student_course_result | The grade for one named course | What did I get in CO3554? |
| get_my_attendance | Overall and per-course attendance against the 80% rule, per attempt for a repeated course | Is my attendance okay? |
| my_outstanding_modules | Courses still owed on an R, F or L grade | Do I still owe any modules? |
| get_my_medical_submissions | Each medical certificate and the decision for each course on it | Was my medical approved? |
| get_my_insights | Everything the system has noticed: attendance risk, a GPA drop, a close deadline, an open enrolment window | Is there anything I should worry about? |

## 6.2 The curriculum — 3 tools

<!-- widths: 30,40,30 -->
| Tool | What it returns | Example question |
|---|---|---|
| get_upcoming_courses | The courses in the student's own next semester | What am I taking next semester? |
| get_courses_by_semester | The courses of any named semester, 1 to 8, for the student's department | What courses are in semester 7? |
| get_course_info | Catalogue details for a course: credits, category, semester | How many credits is Data Management? |

## 6.3 Minors — 1 tool

<!-- widths: 30,40,30 -->
| Tool | What it returns | Example question |
|---|---|---|
| get_my_minor_progress | The minors the department offers, the credits each needs, the courses that count, and which the student has passed | What do I need for the Data Management minor? |

## 6.4 The Handbook — 1 tool (this is the RAG part)

<!-- widths: 30,40,30 -->
| Tool | What it returns | Example question |
|---|---|---|
| search_handbook | The four best-matching Handbook passages, each with section and page. Runs search_handbook_hybrid. | What happens if I fail a course? |

## 6.5 The faculty website — 1 tool (RAG again)

<!-- widths: 30,40,30 -->
| Tool | What it returns | Example question |
|---|---|---|
| search_faculty_website | The best-matching sections of eng.sjp.ac.lk, each with its page title and link. Runs search_faculty_site. | Who is the head of the Computer Engineering department? |

The website is copied into the database ahead of time, every night, by a separate function (faculty-site-sync), so a student never waits for a web page to load and nothing outside the faculty's own site is read. Unlike the Handbook, the website search uses words only, no vectors: it ranks a section by how many of the question's words it contains.

8 + 3 + 1 + 1 + 1 = **14 tools**.

# 7. One question, start to finish

Here is what happens when a student asks: **"What do I need for First Class, and what does the Handbook say about it?"** (The numbers below are an example.)

1. **The browser sends the question.** AIAssistant.tsx sends the message and the last 8 messages of the conversation to the ai-assistant Edge Function, with the student's sign-in token attached.
1. **The server checks who is asking.** The Edge Function verifies the token, checks the daily usage limits, and builds a database client that carries the student's own token.
1. **Turn 1 — the model asks for two tools at once.** The model receives the question, its instructions and the 14 tool descriptions. It replies: run get_academic_standing, and run search_handbook with "first class honours requirements".
1. **The tools run.** The standing comes back (for example CGPA 3.61, 100 credits done). The Handbook search returns the passage "Requirement for Award of Class Honours" on page 27, which sets First Class at a GPA of 3.70.
1. **Turn 2 — the model asks for the maths.** It is not allowed to calculate a GPA itself, so it calls calculate_gpa_target with 3.70. The answer: an average of 3.90 is needed across the remaining credits, and the highest reachable CGPA is 3.73.
1. **Turn 3 — the answer.** With all the facts in hand, the model writes a short reply: the target is still reachable but only just — a 3.90 average is close to perfect — and First Class needs 3.70 according to the Handbook, page 27.
```
  Turn 1   model  -> get_academic_standing()          (tool)
           model  -> search_handbook("first class")    (tool, RAG)
  Turn 2   model  -> calculate_gpa_target(3.70)        (tool)
  Turn 3   model  -> writes the answer, cites page 27
```

Each turn is a separate request to the model. The loop stops after at most **6 turns** or **60 seconds**, whichever comes first, so the assistant always has time to reply.

# 8. How it is kept honest

The model's instructions (SYSTEM_INSTRUCTION in the Edge Function) start with grounding rules that override everything else:

- **Only state facts a tool returned** in this conversation. Never estimate, infer or round a number.
- **Never do GPA arithmetic.** Always call calculate_gpa_target or get_academic_standing. The Graduation Planner uses the same functions, so the assistant and the planner can never disagree.
- **Personal questions use personal tools.** A curriculum list or a Handbook passage must never be presented as the student's own results.
- **Cite the Handbook** with section and page. If the first search is thin, try once more with different words before saying there is no answer.
- **Say what it cannot see.** If a tool errors or returns nothing, say so plainly and point to the page that can help.
- **Do not oversell.** "Feasible" means arithmetically possible, not likely. If the margin is tiny, say so.

# 9. Security

- **The student's own token is used for every tool.** The database applies Row Level Security exactly as if the student had opened a page, so the assistant cannot see anything the student could not.
- **No tool accepts a student id.** There is no way to even ask for another student's data.
- **No model key ever reaches the browser.** The Gemini keys and the faculty model's address are secrets of the Edge Function.
- **The assistant only reads.** It never enrols, submits, withdraws or changes anything.

# 10. Limits

<!-- widths: 33,67 -->
| Limit | What it means |
|---|---|
| Which model | The faculty can run its own open model (Qwen 2.5 3B works on an ordinary CPU) and fall back to Gemini, with as many keys as it likes. Changing either is a secret, not code. |
| Gemini free tier | Only a few requests a minute, and one question uses three or four (one per turn). A paid key, more keys, or the faculty's own model removes the ceiling. |
| Rate limits | A 429 (too many requests) is waited out and retried; a 503 (model busy) is retried after a few seconds. The student sees a plain message only if every try fails. |
| What it cannot see | Course feedback, and whether an enrolment window is open right now. It says so and points to the Feedback or Enrollment page. |
| Our own caps | AI_DAILY_QUOTA (faculty-wide) and AI_PER_STUDENT_DAILY, counted in ai_assistant_usage_log. Set high during development; they guard against a runaway loop. |

# 11. Words used in this guide

<!-- widths: 29,71 -->
| Word | Meaning |
|---|---|
| LLM | Large language model — a program trained on a lot of text that can read and write natural language. PES uses Google Gemini, or an open model such as Qwen that the faculty runs itself. |
| RAG | Retrieval-Augmented Generation — look up relevant documents first, then have the model answer from them. |
| Chunk | One piece of the Handbook, about 150 words, stored with its heading and page. |
| Embedding | A list of numbers (384 here) that describes the meaning of a piece of text, so similar texts have similar numbers. |
| Full-text search | Searching by words, after reducing each word to its stem. |
| Hybrid search | Using word search and meaning search together and merging the results. |
| Tool / function calling | The model asks the server to run a named function and uses what it returns. |
| Grounding | Making sure every fact in an answer comes from a real source — a tool result or a Handbook passage. |
| Edge Function | A small server program hosted by Supabase. The assistant's logic runs in one called ai-assistant. |
| Row Level Security | Database rules that decide which rows each signed-in user may see. |

# 12. Where to find it in the code

<!-- widths: 47,53 -->
| File | What it does |
|---|---|
| pes_app/src/app/pages/AIAssistant.tsx | The chat page the student sees |
| pes_app/src/lib/llmAssistant.ts | Calls the Edge Function |
| supabase/functions/ai-assistant/index.ts | The tool list, the instructions, and the tool loop |
| pes-scripts/rag/extract_handbook.py | Reads the Handbook PDF and finds its headings |
| pes-scripts/rag/chunk_and_embed_v2.mjs | Cuts the Handbook into chunks and embeds them |
| pes-scripts/rag/reload_chunks_v2.mjs | Loads the chunks into handbook_chunks |
| pes-scripts/rag/benchmark_retrieval.mjs | Runs the 18 test questions against the search |
| supabase/migrations/ (search_handbook_hybrid) | The hybrid search function in the database |
