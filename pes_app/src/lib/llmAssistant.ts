import { supabase } from "./supabase";

export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export type AssistantResult =
  | { ok: true; reply: string }
  /** The assistant was reached but could not answer, and said so itself. */
  | { ok: false; kind: "refused"; reply: string }
  /** We never got an answer: network down, function error, bad deploy. */
  | { ok: false; kind: "unreachable"; detail: string };

/**
 * The assistant.
 *
 * Every message goes here now. This used to be an escalation tier reached
 * only after a keyword cascade and a vector search had both failed, which
 * meant the model almost never saw a question — and the answers students
 * actually got were assembled from template strings with numbers slotted in.
 * The model decides for itself which of the database tools to call; see
 * supabase/functions/ai-assistant/index.ts for the tool list and the rule
 * that it may only state facts a tool returned.
 *
 * `history` is the conversation so far, oldest first, so a follow-up like
 * "what about semester 5?" resolves against what was already said instead of
 * being answered in isolation.
 *
 * Failure is reported rather than swallowed. The previous version returned
 * null for every kind of failure alike, so a completely dead LLM tier — which
 * is what a wrong model name had made it — was indistinguishable from a
 * question it merely could not answer.
 */
export async function askLlmAssistant(
  message: string,
  history: ChatHistoryItem[] = [],
): Promise<AssistantResult> {
  try {
    const { data, error } = await supabase.functions.invoke("ai-assistant", {
      body: { message, history },
    });

    if (error) {
      // The function returns its own detail on a 502; surface it to the
      // console so a broken deploy is diagnosable from the browser.
      console.error("[ai-assistant]", error);
      return { ok: false, kind: "unreachable", detail: error.message ?? "unknown" };
    }

    const reply = (data as { reply?: string; error?: string } | null)?.reply;
    if (typeof reply === "string" && reply.trim().length > 0) {
      return { ok: true, reply };
    }

    const detail = (data as { error?: string } | null)?.error ?? "empty reply";
    console.error("[ai-assistant] no reply:", detail);
    return { ok: false, kind: "unreachable", detail };
  } catch (err) {
    console.error("[ai-assistant] threw:", err);
    return {
      ok: false,
      kind: "unreachable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
