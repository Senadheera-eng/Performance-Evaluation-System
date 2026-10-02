# Running the AI assistant on the faculty's own model

The assistant can answer with a model the faculty runs on its own machine — Llama, Qwen or a similar open model — instead of, or before, Google Gemini. A model on the faculty's hardware has no per-minute or per-day allowance: its only limit is the machine. Students' records also stay inside the faculty rather than going to an outside service.

Nothing in the app changes. The `ai-assistant` Edge Function reads which models to use from Supabase secrets (see [Configuration](#4-tell-pes-about-it)) and tries them in order. If the local model is down, busy or too slow, the next provider in the list answers instead.

## 1. The machine

The function sends every question with a long system prompt and fourteen tool definitions. That is about 9,000 tokens before the student's question and the tool results are added, so the model needs a context window of at least **16k tokens**. Processing that much text on a CPU takes minutes per question, so **a GPU is required**.

|                | Minimum (one question at a time)                   | Recommended (a few students at once)                    |
| -------------- | -------------------------------------------------- | ------------------------------------------------------- |
| GPU            | NVIDIA, 12–16 GB VRAM (RTX 3060 12 GB, RTX 4060 Ti 16 GB) | NVIDIA, 24 GB VRAM (RTX 3090, RTX 4090, RTX A5000)       |
| Model          | 7–8B instruct, 4-bit (e.g. `llama3.1:8b`, `qwen2.5:7b`) | 14B instruct, 4-bit (e.g. `qwen2.5:14b`)                |
| Context        | 16k                                                | 32k                                                     |
| CPU / RAM      | 8 cores, 32 GB                                     | 8–16 cores, 64 GB                                       |
| Disk           | 100 GB SSD                                         | 200 GB SSD                                              |
| OS             | Ubuntu 22.04 or 24.04 with the NVIDIA driver       | same                                                    |

The assistant depends on **tool calling**: it decides which database lookup to run. Qwen models are noticeably more reliable at this than Llama 3.1 8B. Try both on real questions before you choose. Newer versions of these models work the same way.

## 2. Install the model server

[Ollama](https://ollama.com) is the simplest option. llama.cpp's `llama-server` and vLLM also work, because the function speaks the OpenAI-compatible API that all three serve.

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:14b          # or llama3.1:8b, qwen2.5:7b
```

Raise the context window and allow more than one question at a time. Run `sudo systemctl edit ollama` and add:

```ini
[Service]
Environment="OLLAMA_CONTEXT_LENGTH=16384"
Environment="OLLAMA_NUM_PARALLEL=2"
Environment="OLLAMA_KEEP_ALIVE=24h"
```

Then restart Ollama with `sudo systemctl restart ollama`. Each parallel slot needs its own share of VRAM for the context, so raise `OLLAMA_NUM_PARALLEL` only while the model still fits on the GPU (`ollama ps` shows this).

Check that Ollama answers on the machine itself:

```bash
curl http://localhost:11434/v1/chat/completions -H 'Content-Type: application/json' \
  -d '{"model":"qwen2.5:14b","messages":[{"role":"user","content":"Say ok"}]}'
```

## 3. Make it reachable — with a key

The Edge Function runs in Supabase's cloud, so it must be able to reach the model server over **HTTPS from the internet**. Ollama has no sign-in of its own, so **never expose port 11434 directly**: anyone who found it could use the faculty's GPU. Put a proxy in front that requires a secret key.

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

| Secret              | Value                                                    |
| ------------------- | -------------------------------------------------------- |
| `LOCAL_LLM_URL`     | `https://ai.eng.example.lk/v1`                           |
| `LOCAL_LLM_MODEL`   | the model you pulled, e.g. `qwen2.5:14b`                 |
| `LOCAL_LLM_API_KEY` | the same key as `PES_LLM_KEY`                            |
| `AI_PROVIDERS`      | `local,gemini` (the default): the local model first, Gemini as the fallback. Use `local` to never call Gemini, or `gemini,local` to use the local model only as the fallback |
| `AI_DEADLINE_MS`    | optional, e.g. `120000` if the local model needs longer than the default 60 s. The maximum is 140 s |

Secrets take effect on the next request, with no redeploy.

To check every configured model at once, call the function's health check with the service role key:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/ai-assistant" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
  -d '{"diagnose":true}'
```

The `probes` list shows each provider, whether it answered, and how long it took.

## Gemini API keys

`GEMINI_API_KEYS` takes a comma-separated list, and `GEMINI_API_KEY` still works on its own. When a key is refused or out of allowance, the assistant moves to the next one. It leaves the spent key alone until its limit resets: about a minute for a per-minute limit, an hour for a daily one, and half an hour for a key that was rejected.

Use the list for keys the faculty legitimately holds, such as a paid key with a backup. **Do not** create keys on several free Google accounts to get around the free tier's limits. Google's API terms forbid circumventing usage limits, and such keys can be suspended. Also, on the free tier Google may use the prompts it receives — which here include students' grades — to improve its products; the paid tier does not. The faculty's own model, with one paid Gemini key as its fallback, avoids both problems.
