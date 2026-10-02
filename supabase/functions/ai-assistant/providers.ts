// The models the assistant can answer with, behind one interface.
//
// Two kinds:
//
//   * A model PES runs itself -- Llama, Qwen or similar, served by Ollama,
//     llama.cpp or vLLM on a faculty machine. All three speak the same
//     OpenAI-compatible chat API, so one adapter covers them. It has no
//     per-minute or per-day allowance: its only limit is the hardware.
//   * Gemini, with one or more API keys. Each key is a provider of its own,
//     so a key that is out of allowance, revoked or mistyped is stepped past
//     rather than taking the assistant down with it.
//
// The assistant tries them in order (see index.ts). A provider that cannot
// serve right now -- rate limited, overloaded, unreachable -- throws
// Unavailable, and the next one is tried. Anything else is a real error.
//
// Nothing here uses Deno APIs, so it can be tested under Node.

/** A tool as index.ts declares it: Gemini's schema dialect. */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** One reply from the model: either tool calls to run, or the answer. */
export interface ModelTurn {
  text: string | null;
  calls: ToolCall[];
}

export interface ChatStart {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  tools: ToolDeclaration[];
  temperature: number;
}

/** One question's conversation with one provider, in its own wire format. */
export interface ModelSession {
  next(timeoutMs: number): Promise<ModelTurn>;
  answer(results: { call: ToolCall; result: unknown }[]): void;
}

export interface Provider {
  /** Stable, for remembering cooldowns: "local", "gemini-1", ... */
  id: string;
  /** For logs and the operator health check. Never contains a key. */
  label: string;
  start(chat: ChatStart): ModelSession;
}

export type UnavailableReason = "rate_limited" | "overloaded" | "unreachable" | "bad_key";

/** This provider cannot serve now; try the next. */
export class Unavailable extends Error {
  constructor(
    readonly reason: UnavailableReason,
    message: string,
    /** How long to leave this provider alone before trying it again. */
    readonly cooldownMs: number,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/* A model PES runs itself (OpenAI-compatible)                         */
/* ------------------------------------------------------------------ */

/** Gemini writes types in capitals ("OBJECT"); JSON Schema in lower case. */
function toJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    out[k] = k === "type" && typeof v === "string" ? v.toLowerCase() : toJsonSchema(v);
  }
  return out;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  }
  return {};
}

/*
  Smaller open models sometimes write a tool call as JSON in their reply
  instead of in tool_calls -- Llama 3.1 8B in particular. When the whole reply
  is such an object, naming one of our tools, it is a call, not an answer, and
  showing it to the student would be showing them our plumbing.
*/
function callWrittenAsText(text: string, toolNames: Set<string>): ToolCall | null {
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "").replace(/^<\|python_tag\|>/, "");
  if (!t.startsWith("{") || !t.endsWith("}")) return null;
  try {
    const v = JSON.parse(t);
    const name = v?.name ?? v?.function?.name;
    if (typeof name !== "string" || !toolNames.has(name)) return null;
    return { id: "text-call", name, args: parseArgs(v.arguments ?? v.parameters ?? v.function?.arguments) };
  } catch {
    return null;
  }
}

/** Tool results can be long; a local model's context is not. */
const LOCAL_RESULT_LIMIT = 12_000;

export function localProvider(opts: {
  url: string;
  model: string;
  apiKey?: string | null;
}): Provider {
  const endpoint = opts.url.replace(/\/+$/, "") + "/chat/completions";
  return {
    id: "local",
    label: `local model ${opts.model}`,
    start(chat) {
      const toolNames = new Set(chat.tools.map((t) => t.name));
      const tools = chat.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: toJsonSchema(t.parameters) },
      }));
      // deno-lint-ignore no-explicit-any
      const messages: any[] = [
        { role: "system", content: chat.system },
        ...chat.history.map((h) => ({ role: h.role, content: h.content })),
        { role: "user", content: chat.message },
      ];
      let callCount = 0;

      return {
        async next(timeoutMs) {
          let res: Response;
          try {
            res = await fetch(endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
              },
              body: JSON.stringify({
                model: opts.model,
                messages,
                ...(tools.length ? { tools } : {}),
                temperature: chat.temperature,
                stream: false,
              }),
              signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
            });
          } catch (e) {
            // Down, unreachable, or too slow: all mean "not now".
            const slow = e instanceof Error && /timeout|abort/i.test(e.name + e.message);
            throw new Unavailable(
              "unreachable",
              slow ? `${opts.model} did not answer in time` : `cannot reach the local model: ${String(e)}`,
              slow ? 0 : 60_000,
            );
          }
          if (res.status === 429 || res.status === 503) {
            throw new Unavailable("overloaded", `local model is busy (${res.status})`, 5_000);
          }
          if (res.status === 401 || res.status === 403) {
            throw new Unavailable("bad_key", `local model refused the key (${res.status})`, 10 * 60_000);
          }
          if (!res.ok) {
            const body = await res.text();
            if (res.status >= 500 || res.status === 404) {
              throw new Unavailable("unreachable", `local model ${res.status}: ${body.slice(0, 300)}`, 60_000);
            }
            throw new Error(`local model ${res.status}: ${body.slice(0, 300)}`);
          }

          const data = await res.json();
          const msg = data?.choices?.[0]?.message ?? {};
          // deno-lint-ignore no-explicit-any
          const raw: any[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
          let calls: ToolCall[] = raw
            .filter((c) => c?.function?.name)
            .map((c) => ({
              id: typeof c.id === "string" && c.id ? c.id : `call_${++callCount}`,
              name: c.function.name,
              args: parseArgs(c.function.arguments),
            }));
          const content = typeof msg.content === "string" ? msg.content : null;

          if (calls.length === 0 && content) {
            const written = callWrittenAsText(content, toolNames);
            if (written) calls = [{ ...written, id: `call_${++callCount}` }];
          }

          if (calls.length > 0) {
            messages.push({
              role: "assistant",
              // A call written as text is replayed as a proper call, not as text.
              content: raw.length ? (content ?? "") : "",
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            });
            return { text: null, calls };
          }
          return { text: content?.trim() || null, calls: [] };
        },

        answer(results) {
          for (const { call, result } of results) {
            let content = JSON.stringify(result ?? null);
            if (content.length > LOCAL_RESULT_LIMIT) {
              content = content.slice(0, LOCAL_RESULT_LIMIT) + " …(truncated)";
            }
            messages.push({ role: "tool", tool_call_id: call.id, content });
          }
        },
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Gemini, one provider per API key                                    */
/* ------------------------------------------------------------------ */

/*
  The model a key actually serves, learned once per worker. Model names come
  and go; the first candidate that answers is remembered and tried first.
*/
let resolvedGeminiModel: string | null = null;
export const geminiModelInUse = () => resolvedGeminiModel;

/** How long a 429 asks us to wait: its RetryInfo, or a day's quota, or a minute. */
function rateLimitCooldown(body: string): number {
  if (/PerDay/i.test(body)) return 60 * 60_000; // re-check hourly
  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (m) return Math.ceil(Number(m[1]) * 1000);
  return 60_000;
}

export function geminiProvider(opts: {
  key: string;
  /** Position in the pool, from 1. */
  index: number;
  models: string[];
}): Provider {
  const keyHint = `…${opts.key.slice(-4)}`;
  return {
    id: `gemini-${opts.index}`,
    label: `Gemini key ${opts.index} (${keyHint})`,
    start(chat) {
      // deno-lint-ignore no-explicit-any
      const contents: any[] = [
        ...chat.history.map((h) => ({
          role: h.role === "assistant" ? "model" : "user",
          parts: [{ text: h.content }],
        })),
        { role: "user", parts: [{ text: chat.message }] },
      ];
      const body = () => ({
        contents,
        ...(chat.tools.length ? { tools: [{ functionDeclarations: chat.tools }] } : {}),
        systemInstruction: { parts: [{ text: chat.system }] },
        generationConfig: { temperature: chat.temperature },
      });

      return {
        async next(timeoutMs) {
          const data = await generate(opts, keyHint, body(), timeoutMs);
          const candidate = data.candidates?.[0];
          // deno-lint-ignore no-explicit-any
          const parts: any[] = candidate?.content?.parts ?? [];
          // deno-lint-ignore no-explicit-any
          const callParts = parts.filter((p: any) => p.functionCall);
          if (callParts.length > 0) {
            /* Echo the model's turn back exactly as it came: Gemini 3
               attaches a thought_signature to each call, and a rebuilt part
               without it is rejected on the next request. */
            contents.push(candidate.content);
            return {
              text: null,
              // deno-lint-ignore no-explicit-any
              calls: callParts.map((p: any, i: number) => ({
                id: `g${contents.length}-${i}`,
                name: p.functionCall.name,
                args: p.functionCall.args ?? {},
              })),
            };
          }
          // deno-lint-ignore no-explicit-any
          const textPart = parts.find((p: any) => typeof p.text === "string");
          return { text: textPart?.text ?? null, calls: [] };
        },
        answer(results) {
          contents.push({
            role: "user",
            parts: results.map(({ call, result }) => ({
              functionResponse: { name: call.name, response: { result } },
            })),
          });
        },
      };
    },
  };
}

/*
  One generateContent call with one key, trying each candidate model until
  one is served. Rate limits are counted per model, so a model out of
  allowance moves on to the next; when every model is, the key is.
*/
async function generate(
  opts: { key: string; index: number; models: string[] },
  keyHint: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const tryList = resolvedGeminiModel && opts.models.includes(resolvedGeminiModel)
    ? [resolvedGeminiModel, ...opts.models.filter((m) => m !== resolvedGeminiModel)]
    : opts.models;
  let limited: Unavailable | null = null;
  let lastError = "";

  for (const model of tryList) {
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": opts.key },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
        },
      );
    } catch (e) {
      throw new Unavailable("unreachable", `Gemini could not be reached: ${String(e)}`, 0);
    }

    if (res.ok) {
      if (resolvedGeminiModel !== model) {
        console.log(`ai-assistant: Gemini model ${model}`);
        resolvedGeminiModel = model;
      }
      return await res.json();
    }

    lastError = await res.text();

    if (res.status === 429) {
      limited = new Unavailable(
        "rate_limited",
        `Gemini key ${opts.index} (${keyHint}) is rate limited on ${model}`,
        rateLimitCooldown(lastError),
      );
      continue;
    }
    if (res.status === 503 || res.status === 500) {
      limited ??= new Unavailable("overloaded", `${model} is overloaded (${res.status})`, 4_000);
      continue;
    }
    /* A revoked, mistyped or blocked key. Leave it alone for a while so the
       rest of the pool is not slowed by it on every question. */
    if (
      res.status === 401 || res.status === 403 ||
      /API key not valid|API_KEY_INVALID|PERMISSION_DENIED|API key expired/i.test(lastError)
    ) {
      throw new Unavailable(
        "bad_key",
        `Gemini key ${opts.index} (${keyHint}) was refused: ${lastError.slice(0, 160)}`,
        30 * 60_000,
      );
    }
    const notFound = res.status === 404 || /not found|not supported|unsupported model|no longer available/i.test(lastError);
    if (notFound) {
      console.error(`ai-assistant: model "${model}" is not available — trying the next. ${lastError.slice(0, 200)}`);
      if (resolvedGeminiModel === model) resolvedGeminiModel = null;
      continue;
    }
    throw new Error(`Gemini ${res.status}: ${lastError.slice(0, 400)}`);
  }

  if (limited) throw limited;
  throw new Error(`No usable Gemini model. Tried: ${tryList.join(", ")}. Last error: ${lastError.slice(0, 300)}`);
}

/* ------------------------------------------------------------------ */
/* Answering with the first provider that can                          */
/* ------------------------------------------------------------------ */

export interface ChainOutcome {
  text: string | null;
  /** The provider that answered, or null when none could. */
  answeredBy: string | null;
  ranOutOfTime: boolean;
  /** Some provider was out of allowance. */
  rateLimited: boolean;
  /** Some provider failed in a way waiting will not fix. */
  realError: boolean;
  failures: string[];
}

/**
 * Answers one question with the first provider that can.
 *
 * One provider answers the whole question. If it fails part-way, the next
 * starts the question again from the beginning: the tools only read, so
 * running them twice costs time, not correctness, and one conversation never
 * has to be translated between two providers' formats.
 *
 * A provider that said "not now" is left alone for as long as it asked
 * (cooldownUntil, shared across questions). When every provider says "not
 * now", a short limit is waited out, as a person would, if the deadline
 * leaves room; a day's limit is not.
 */
export async function answerWithFirstAvailable(opts: {
  providers: Provider[];
  cooldownUntil: Map<string, number>;
  chat: ChatStart;
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  startedAt: number;
  deadlineMs: number;
  maxToolTurns: number;
  /** How many times to wait for every provider to come back. */
  maxWaits: number;
  shortWaitMs: number;
  longWaitMs: number;
}): Promise<ChainOutcome> {
  const out: ChainOutcome = {
    text: null,
    answeredBy: null,
    ranOutOfTime: false,
    rateLimited: false,
    realError: false,
    failures: [],
  };
  const elapsed = () => Date.now() - opts.startedAt;

  async function answerWith(provider: Provider): Promise<string | null> {
    const session = provider.start(opts.chat);
    for (let turn = 0; turn < opts.maxToolTurns; turn++) {
      const remaining = opts.deadlineMs - elapsed();
      if (remaining < 2_000) {
        out.ranOutOfTime = true;
        console.warn(`ai-assistant: deadline hit after ${turn} tool turns (${provider.label})`);
        return null;
      }
      const reply = await session.next(remaining);
      if (reply.calls.length === 0) return reply.text;
      /* All calls in the turn are answered, not just the first: the model
         can ask for two lookups at once. */
      const results = [];
      for (const call of reply.calls) {
        results.push({ call, result: await opts.executeTool(call.name, call.args) });
      }
      session.answer(results);
    }
    return null;
  }

  for (let pass = 0; pass <= opts.maxWaits; pass++) {
    const now = Date.now();
    const ready = opts.providers.filter((p) => (opts.cooldownUntil.get(p.id) ?? 0) <= now);
    /* All cooling down: try them all anyway. A cooldown is a guess, and a
       guess is not a reason to refuse a student without asking. */
    let soonest = Infinity;
    for (const provider of ready.length ? ready : opts.providers) {
      try {
        out.text = await answerWith(provider);
        out.answeredBy = provider.label;
        opts.cooldownUntil.delete(provider.id);
        return out;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        out.failures.push(`${provider.label}: ${detail.slice(0, 300)}`);
        if (err instanceof Unavailable) {
          if (err.cooldownMs > 0) opts.cooldownUntil.set(provider.id, Date.now() + err.cooldownMs);
          soonest = Math.min(soonest, err.cooldownMs);
          if (err.reason === "rate_limited") out.rateLimited = true;
          console.warn(`ai-assistant: ${provider.label} unavailable (${err.reason}) — trying the next. ${detail.slice(0, 200)}`);
        } else {
          out.realError = true;
          console.error(`ai-assistant: ${provider.label} failed — trying the next. ${detail.slice(0, 300)}`);
        }
      }
      if (elapsed() > opts.deadlineMs - 2_000) {
        out.ranOutOfTime = true;
        return out;
      }
    }
    if (out.realError || pass === opts.maxWaits || soonest > 60_000) break;

    const waitMs = Math.min(Math.max(soonest, opts.shortWaitMs), opts.longWaitMs);
    if (elapsed() + waitMs + 8_000 >= opts.deadlineMs) break;
    console.warn(`ai-assistant: every provider is busy, waiting ${waitMs}ms (wait ${pass + 1})`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Which providers, in which order                                     */
/* ------------------------------------------------------------------ */

/**
 * The providers configured, in the order to try them.
 *
 * AI_PROVIDERS sets the order: "local,gemini" (the default when a local model
 * is configured) answers with the faculty's own model and falls back to
 * Gemini; "gemini,local" the other way round; "local" alone never calls
 * Gemini. GEMINI_API_KEYS is a comma-separated list; GEMINI_API_KEY still
 * works on its own.
 */
export function configuredProviders(env: (name: string) => string | undefined, models: string[]): Provider[] {
  const local = env("LOCAL_LLM_URL")?.trim()
    ? localProvider({
        url: env("LOCAL_LLM_URL")!.trim(),
        model: env("LOCAL_LLM_MODEL")?.trim() || "llama3.1:8b",
        apiKey: env("LOCAL_LLM_API_KEY")?.trim() || null,
      })
    : null;

  const keys = [
    ...(env("GEMINI_API_KEYS") ?? "").split(/[\s,]+/),
    env("GEMINI_API_KEY") ?? "",
  ]
    .map((k) => k.trim())
    .filter((k, i, all) => k && all.indexOf(k) === i);
  const gemini = keys.map((key, i) => geminiProvider({ key, index: i + 1, models }));

  const order = (env("AI_PROVIDERS") ?? "local,gemini")
    .split(",")
    .map((s) => s.trim().toLowerCase());
  const out: Provider[] = [];
  for (const name of order) {
    if (name === "local" && local) out.push(local);
    if (name === "gemini") out.push(...gemini);
  }
  return out;
}
