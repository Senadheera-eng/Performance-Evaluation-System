import { askLlmAssistant, type ChatHistoryItem } from "./llmAssistant";

export type { ChatHistoryItem };

/**
 * The PES AI Assistant, client side.
 *
 * This file used to be six hundred lines of regular expressions, a semantic
 * intent classifier over six fixed intents, and one hand-written sentence per
 * intent with the real numbers interpolated into it. That is why the
 * assistant read as a set of canned responses: for anything it thought it
 * recognised, it was one. The language model sat at the very back of the
 * queue and was reached only when everything else had already given up.
 *
 * That order is now inverted. Every message goes to the model, which decides
 * for itself which of the database functions to call and writes the answer
 * from what they return. The grounding rules live with the tools, in the
 * edge function, because that is the only place they can actually be
 * enforced.
 *
 * What is deliberately NOT here any more:
 *
 *   - Intent classification. The model does this better, and every intent the
 *     classifier did not have was a question the assistant could not answer
 *     at all.
 *   - Template answers. They could not rephrase, could not take a follow-up,
 *     and could not combine two facts into one reply.
 *   - Client-side embeddings. The 25 MB model that ran in the browser existed
 *     to serve the classifier and a handbook search that the model now does
 *     server-side.
 *
 * What IS still here is one honest failure message. If the assistant cannot
 * be reached, saying so is right; inventing an answer locally is what this
 * rewrite exists to stop.
 */

const UNREACHABLE_REPLY =
  "I can't reach the assistant right now — that's a problem on my side, not " +
  "with your question. Please try again in a moment.\n\n" +
  "In the meantime, your **Results**, **Graduation Planner** and **Enrollment** " +
  "pages have the same information, straight from your records.";

/** Send a message and get the assistant's reply. */
export async function getAssistantReply(
  message: string,
  history: ChatHistoryItem[] = [],
): Promise<string> {
  const result = await askLlmAssistant(message, history);
  if (result.ok) return result.reply;
  if (result.kind === "refused") return result.reply;
  return UNREACHABLE_REPLY;
}
