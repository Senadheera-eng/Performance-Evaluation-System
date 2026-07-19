import { supabase } from "./supabase";

/**
 * LLM escalation tier (Gemini, via the ai-assistant Edge Function) — only
 * called when the free client-side paths (semantic intent classifier +
 * handbook vector search) both come up empty. See
 * supabase/functions/ai-assistant/index.ts for the actual tool-calling
 * loop and grounding rules; this is just the thin client wrapper.
 *
 * Returns null on any failure (network error, function error, quota
 * exhausted with no reply) so the caller can fall through to the existing
 * honest "I don't know" message rather than show nothing or throw.
 */
export async function askLlmAssistant(message: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke("ai-assistant", {
      body: { message },
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
