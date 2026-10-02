# Running the AI assistant on the faculty's own model

The assistant can answer with a model the faculty runs on its own machine — Qwen, Llama or a similar open model — instead of, or before, Google Gemini. A model on the faculty's machine has no per-minute or per-day allowance: its only limit is the machine. Students' records also stay inside the faculty rather than going to an outside service.

**No GPU is needed.** In *small mode* (the default), a 3B model on an ordinary 4-core CPU with **8 GB of RAM** answers typical questions in 2–30 seconds (measured below).

Nothing in the app changes. The `ai-assistant` Edge Function reads which models to use from Supabase secrets (see [step 4](#4-tell-pes-about-it)) and tries them in order. If the local model is down, busy or too slow, the next provider in the list answers instead.

## 1. Choose the machine and the model

| RAM | Model | Ollama name | Memory used | Verdict |
| --- | --- | --- | --- | --- |
| **8 GB** | Qwen 2.5 3B, 4-bit | `qwen2.5:3b` | 2.8 GB | **Recommended.** It picked the right lookup for every test question, and its answers matched the data |
| 4 GB | Qwen 3 1.7B, 4-bit | `qwen3:1.7b` | 2.4 GB | Works and is fast, but sometimes picks the wrong lookup. In testing it said a 3.7 CGPA was reachable when it was not. Use it only with Gemini as a fallback, or for trying things out |
| 16 GB+ with an NVIDIA GPU | Qwen 2.5 7B–14B | `qwen2.5:7b`, `qwen2.5:14b` | 5–10 GB of VRAM | Closest to Gemini. Set `LOCAL_LLM_PROFILE=full` |

The CPU should have 4 or more cores; more cores are faster. Use Ubuntu 22.04 or 24.04 (Windows also works with Ollama). Allow 10 GB of disk.

### Measured on a 4-core CPU with no GPU

Ollama 0.35, `qwen2.5:3b`, small mode, real handbook and website search results, and a test student's records:

| Question | Lookup the model chose | Time |
| --- | --- | --- |
| hi | — | 2 s |
| What is my current CGPA? | `get_academic_standing` | 5–9 s |
| What grade did I get for CO3554? | `get_student_course_result` | 7 s |
| Can I still get a CGPA of 3.7? | `calculate_gpa_target` | 8–28 s |
| How is my attendance? | `get_my_attendance` | 2 s |
| Show my semester 3 results | `get_student_results` | 3 s |
| What happens if I fail a course? | `search_handbook` | 12–20 s |
| When are the batch 07 exams? | `search_faculty_website` | 19–21 s |

The first question after the model starts takes 15–25 s longer, because that is when the model reads its instructions. After that it reuses them.

**A CPU answers one question at a time.** When several students ask at once, the others wait their turn. So keep the queue short (see `OLLAMA_MAX_QUEUE` below). Questions that don't fit in the queue then go straight to the next provider, Gemini, instead of waiting until the deadline.

## 2. Install Ollama and the model

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:3b
```

Run `sudo systemctl edit ollama` and add:

```ini
[Service]
Environment="OLLAMA_CONTEXT_LENGTH=8192"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_QUEUE=3"
Environment="OLLAMA_KEEP_ALIVE=24h"
```

Then restart it with `sudo systemctl restart ollama`.

- `OLLAMA_KEEP_ALIVE=24h` keeps the model loaded, so the instructions are read once rather than once per question.
- `OLLAMA_MAX_QUEUE=3` turns away a fourth waiting question at once, so PES can hand it to Gemini instead.
- On a 4 GB machine, use `qwen3:1.7b` and `OLLAMA_CONTEXT_LENGTH=4096`.

Check that it answers on the machine itself:

```bash
curl http://localhost:11434/v1/chat/completions -H 'Content-Type: application/json' \
  -d '{"model":"qwen2.5:3b","messages":[{"role":"user","content":"Say ok"}]}'
```

llama.cpp's `llama-server` and vLLM also work, because PES speaks the OpenAI-compatible API that all three serve.

## 3. Make it reachable — with a key

The Edge Function runs in Supabase's cloud, so it must be able to reach the model server over **HTTPS from the internet**. Ollama has no sign-in of its own, so **never expose port 11434 directly**: anyone who found it could use the faculty's machine. Put a proxy in front that requires a secret key.

With [Caddy](https://caddyserver.com) on a host name that points at the machine (this needs ports 80 and 443 open, which is a request to the university's IT services):

```caddy
ai.eng.example.lk {
	@pes header Authorization "Bearer {$PES_LLM_KEY}"
	handle @pes {
		reverse_proxy localhost:11434
	}
	respond 401
}
```

Set `PES_LLM_KEY` to a long random string (`openssl rand -hex 32`) in Caddy's environment. If no inbound ports can be opened, a Cloudflare Tunnel (`cloudflared`) pointed at Caddy gives the machine an HTTPS address without opening any.

## 4. Tell PES about it

In Supabase → Edge Functions → Secrets (or `supabase secrets set …`):

| Secret | Value |
| --- | --- |
| `LOCAL_LLM_URL` | `https://ai.eng.example.lk/v1` |
| `LOCAL_LLM_MODEL` | the model you pulled, e.g. `qwen2.5:3b` |
| `LOCAL_LLM_API_KEY` | the same key as `PES_LLM_KEY` |
| `LOCAL_LLM_PROFILE` | `small` (the default, for a CPU) or `full` (for a 7B+ model on a GPU) |
| `AI_PROVIDERS` | `local,gemini` (the default): the local model first, Gemini as the fallback. `local` never calls Gemini; `gemini,local` uses the local model only as the fallback |
| `AI_DEADLINE_MS` | on a CPU, `90000`: how long one question may take before PES gives up on it. The default is 60 s and the maximum 140 s |

New secrets reach the function within a few minutes, as its workers restart; no redeploy is needed.

To check every configured model at once, call the function's health check with the service role key:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/ai-assistant" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
  -d '{"diagnose":true}'
```

The `probes` list shows each provider, whether it answered, and how long it took.

## What small mode does

A 3B model is roughly ten times smaller than the models behind Gemini. Small mode works around what it is bad at, which also makes it fast enough for a CPU:

- **Short instructions.** The rules that protect students stay: only what a tool returned, no GPA arithmetic of its own, personal questions answered from the student's own records. The explanations a large model benefits from are dropped. With the tool descriptions, the prompt comes to about 1,400 tokens instead of 3,100.
- **Instructions read once.** They are identical for every student. The date and the student's name travel with the question instead, so Ollama reuses the instructions it has already read.
- **Lists written by code.** For results, attendance, course lists and outstanding modules, the model picks the lookup and PES lays out the table straight from the data. Without this, the model miscopied a course's credits and took 35 s; with it, the table is exact and takes 2–3 s.
- **Readable search results.** The academic calendar arrives as a grid of codes and dates (`S (2-Mar-2026); E (9-Mar-2026 to 16-Mar-2026)`). It is rewritten as plain lines ("Batch 07 (22ENG): Study break: week of 2-Mar-2026; Exams: 9-Mar-2026 to 16-Mar-2026"). Before this, the 3B model gave another batch's exam dates. Handbook and website results are cut to the best three.
- **A hint for common questions.** "Can I still get a CGPA of 3.7?" carries a note that `calculate_gpa_target` probably answers it. The model may ignore the hint.
- **Sources added.** The handbook pages or website pages a search returned are listed under the answer when the model doesn't cite them itself.
- **Steadier answers.** Temperature 0, at most three lookups per question, and answers capped at about 450 tokens. Thinking models such as Qwen 3 have their reasoning step switched off: it took a one-word answer from 0.3 s to 50 s.

**What it still gets wrong:** questions that need reading between the lines. For example, the handbook's grade table is printed as one run of text, and the 3B model once mixed up what F and L mean. For a faculty-wide release, keep Gemini (a paid key) as the fallback, or use a larger model on a GPU.

## Gemini API keys

`GEMINI_API_KEYS` takes a comma-separated list, and `GEMINI_API_KEY` still works on its own. When a key is refused or out of allowance, the assistant moves to the next one. It leaves the spent key alone until its limit resets: about a minute for a per-minute limit, an hour for a daily one, and half an hour for a key that was rejected.

Use the list for keys the faculty legitimately holds, such as a paid key with a backup. **Do not** create keys on several free Google accounts to get around the free tier's limits. Google's API terms forbid circumventing usage limits, and such keys can be suspended. Also, on the free tier Google may use the prompts it receives — which here include students' grades — to improve its products; the paid tier does not. The faculty's own model, with one paid Gemini key as its fallback, avoids both problems.
