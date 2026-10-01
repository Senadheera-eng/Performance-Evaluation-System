import { useState, useRef, useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Bot, Globe, Info, Loader2, RotateCcw, Send, Sparkles } from "lucide-react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { PageHeader, SectionCard } from "../components/common";
import { ChatMarkdown } from "../components/chat/ChatMarkdown";
import { cn } from "../components/ui/utils";
import { getAssistantReply, type ChatHistoryItem } from "../../lib/chatbotEngine";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

/* Two kinds of question, in two groups: the student's own record and the
   Handbook, and what the faculty publishes on its website (read nightly). */
const suggestionGroups = [
  {
    label: "Your record and the Handbook",
    icon: Sparkles,
    questions: [
      "How am I doing so far?",
      "What do I need for First Class from here?",
      "What courses do I need for my minor?",
      "Is my attendance okay?",
      "Do I still owe any modules?",
      "What happens if I fail a course?",
    ],
  },
  {
    label: "From the faculty website",
    icon: Globe,
    questions: [
      "Are there any new notices from the faculty?",
      "How do I apply for my academic transcript?",
      "When is the convocation and what do I need to send?",
      "Who is the dean of the faculty?",
      "What does the faculty's medical centre offer?",
      "Are there any vacancies at the faculty?",
    ],
  },
];

const suggestedQuestions = suggestionGroups.flatMap((g) => g.questions);

const GREETING: Message = {
  id: "greeting",
  role: "assistant",
  content:
    "Hi — ask me anything about your degree. I can look up your own results and standing, work out what you need for a target class, explain what the Faculty Handbook says, and tell you what's coming next semester. I can also answer from the faculty website — notices, the academic calendar, staff and contacts — with a link to the page. Everything I quote comes from your real records or those pages.",
  timestamp: new Date(),
};

/** "10:32 AM": a chat does not need the seconds. */
const timeOf = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * The AI assistant.
 *
 * The page is the conversation. It used to open on three cards reading
 * "Course Guidance: Available", "Attendance: Your record" and "GPA Planning:
 * Available", with a capabilities card beside the chat saying the same
 * three things again. None of it was a figure or an action, so it is gone,
 * and the chat takes the height of the screen instead of a fixed 560px.
 * Suggested questions stay: beside the chat on a wide screen, and as a row
 * above the box on a phone until the first question is asked.
 */
export default function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const reduce = useReducedMotion();
  const [inputMessage, setInputMessage] = useState("");
  const [isThinking, setIsThinking] = useState(false);

  /* Scrolls the conversation, not the page: scrollIntoView moved the whole
     window to the bottom of the chat on every reply. */
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [messages, isThinking, reduce]);

  const started = messages.some((m) => m.role === "user");

  const handleSendMessage = async (message: string) => {
    if (!message.trim() || isThinking) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: message,
      timestamp: new Date(),
    };
    // Snapshot before this turn's messages are appended — this is exactly
    // the conversation-so-far context the LLM tier needs for follow-ups.
    const history: ChatHistoryItem[] = messages.slice(-8).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    setIsThinking(true);

    try {
      const reply = await getAssistantReply(message, history);
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: reply,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiMessage]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "Something went wrong on my end — please try again.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Beta"
        title="AI Assistant"
        description="Ask about your results, attendance, enrolment, the Faculty Handbook and the faculty website. Answers come from your own record and the faculty's pages."
        actions={
          started ? (
            <Button
              variant="outline"
              size="sm"
              disabled={isThinking}
              onClick={() => setMessages([{ ...GREETING, timestamp: new Date() }])}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              New chat
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        {/* The conversation */}
        <section
          aria-label="Conversation with the assistant"
          className="flex h-[calc(100dvh-15rem)] min-h-[26rem] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-elevation-sm lg:col-span-2"
        >
          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            className="flex-1 space-y-3 overflow-y-auto p-4"
          >
            {messages.map((message) => {
              const mine = message.role === "user";
              return (
                <motion.div
                  key={message.id}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}
                >
                  {!mine && (
                    <span
                      className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                      aria-hidden="true"
                    >
                      <Bot className="h-4 w-4" />
                    </span>
                  )}
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3 py-2",
                      mine
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-muted/40 text-foreground",
                    )}
                  >
                    <span className="sr-only">{mine ? "You:" : "Assistant:"}</span>
                    {mine ? (
                      <p className="whitespace-pre-line text-sm">{message.content}</p>
                    ) : (
                      <ChatMarkdown content={message.content} />
                    )}
                    <p
                      className={cn(
                        "mt-1 text-[11px]",
                        mine ? "text-right text-primary-foreground/70" : "text-muted-foreground",
                      )}
                    >
                      {timeOf(message.timestamp)}
                    </p>
                  </div>
                </motion.div>
              );
            })}
            {isThinking && (
              <div className="flex justify-start gap-2">
                <span
                  className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                  aria-hidden="true"
                >
                  <Bot className="h-4 w-4" />
                </span>
                <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/40 px-3 py-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span className="text-sm">Looking that up…</span>
                </div>
              </div>
            )}
          </div>

          {/* On a phone the suggestions sit here, one scrolling row, until
              the first question is asked. */}
          {!started && (
            <div className="no-scrollbar flex gap-2 overflow-x-auto border-t border-border/70 px-3 pt-3 lg:hidden">
              {suggestedQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => handleSendMessage(q)}
                  className="flex-shrink-0 whitespace-nowrap rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <form
            className="flex gap-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage(inputMessage);
            }}
          >
            <Input
              placeholder="Ask about your results, attendance, a course…"
              aria-label="Your question"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              disabled={isThinking}
              maxLength={1000}
              className="h-10 flex-1"
            />
            <Button
              type="submit"
              disabled={isThinking || !inputMessage.trim()}
              aria-label="Send"
              className="h-10 px-4"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          </form>
          <p className="flex items-start gap-1.5 px-3 pb-3 text-[11px] text-muted-foreground">
            <Info className="mt-px h-3 w-3 flex-shrink-0" aria-hidden="true" />
            The assistant can be wrong. Check anything that matters (a grade,
            a deadline, a rule) with your department.
          </p>
        </section>

        {/* Suggestions beside the chat on a wide screen */}
        <SectionCard
          title="Try asking"
          description="Tap a question to send it."
          className="hidden lg:block"
          bodyClassName="space-y-4"
        >
          {suggestionGroups.map((group) => (
            <div key={group.label} className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <group.icon className="h-3.5 w-3.5" aria-hidden="true" />
                {group.label}
              </p>
              {group.questions.map((question) => (
                <button
                  key={question}
                  type="button"
                  disabled={isThinking}
                  onClick={() => handleSendMessage(question)}
                  className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  <group.icon className="h-3.5 w-3.5 flex-shrink-0 text-primary" aria-hidden="true" />
                  {question}
                </button>
              ))}
            </div>
          ))}
        </SectionCard>
      </div>
    </div>
  );
}
