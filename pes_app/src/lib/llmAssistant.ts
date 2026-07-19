import { supabase } from "./supabase";

export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

/**
 * LLM escalation tier (Gemini, via the ai-assistant Edge Function) — called
 * for greetings/small talk (for a natural, varied reply) and whenever the
 * free client-side paths (semantic intent classifier + handbook vector
 * search) both come up empty. See supabase/functions/ai-assistant/index.ts
 * for the actual tool-calling loop and grounding rules; this is just the
 * thin client wrapper.
 *
 * `history` is the last few turns of the conversation so far (oldest
 * first), so follow-ups after a greeting or a prior answer stay coherent
 * instead of every message being answered in isolation.
 *
 * Returns null on any failure (network error, function error, quota
 * exhausted with no reply) so the caller can fall through to a hardcoded
 * fallback rather than show nothing or throw.
 */
export async function askLlmAssistant(
  message: string,
  history: ChatHistoryItem[] = [],
): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke("ai-assistant", {
      body: { message, history },
    });
    if (error) {
      console.error("ai-assistant function failed:", error);
      return null;
    }
    return (data as { reply?: string } | null)?.reply ?? null;
  } catch (err) {
    console.error("ai-assistant function threw:", err);
    return null;
  }
}
