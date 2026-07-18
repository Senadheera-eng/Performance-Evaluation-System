import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  Send,
  Sparkles,
  BookOpen,
  Calendar,
  Target,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { getAssistantReply } from "../../lib/chatbotEngine";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const suggestedQuestions = [
  "What GPA do I need to graduate with First Class?",
  "What's my current CGPA?",
  "What are my courses next semester?",
  "Tell me about Mathematics V",
  "What is CO3554?",
];

export default function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "Hello! I'm your AI Academic Assistant. I can help with GPA/CGPA planning, your current academic standing, upcoming courses, and module lookups — all based on your real academic records. How can I help today?",
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const handleSendMessage = async (message: string) => {
    if (!message.trim() || isThinking) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: message,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    setIsThinking(true);

    try {
      const reply = await getAssistantReply(message);
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
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-gradient-secondary">
            <Bot className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              AI Academic Assistant
              <Badge className="bg-accent text-accent-foreground">Beta</Badge>
            </h1>
            <p className="text-muted-foreground text-sm">
              Get intelligent insights and guidance for your academic journey
            </p>
          </div>
        </div>
      </motion.div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    Course Guidance
                  </p>
                  <p className="text-lg font-semibold text-foreground">
                    Available
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <Card className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100">
                  <Calendar className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    Attendance Alerts
                  </p>
                  <p className="text-lg font-semibold text-foreground">
                    Real-time
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <Card className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-100">
                  <Target className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">GPA Planning</p>
                  <p className="text-lg font-semibold text-foreground">
                    Available
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chat Interface */}
        <div className="lg:col-span-2">
          <Card className="border-border h-[560px] flex flex-col">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Chat with AI Assistant
              </CardTitle>
            </CardHeader>

            {/* Messages Container */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl p-3 ${
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-line">
                      {message.content}
                    </p>
                    <p
                      className={`text-xs mt-2 ${
                        message.role === "user"
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground"
                      }`}
                    >
                      {message.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </motion.div>
              ))}
              {isThinking && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-start"
                >
                  <div className="max-w-[80%] rounded-2xl p-3 bg-muted text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Looking that up...</span>
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-3 border-t border-border">
              <div className="flex gap-2">
                <Input
                  placeholder="Ask me anything about your academics..."
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  disabled={isThinking}
                  onKeyPress={(e) => {
                    if (e.key === "Enter") {
                      handleSendMessage(inputMessage);
                    }
                  }}
                  className="flex-1 h-9 bg-muted/50 border-0 focus:ring-2 focus:ring-primary/20"
                />
                <Button
                  onClick={() => handleSendMessage(inputMessage)}
                  disabled={isThinking}
                  className="h-9 px-4 bg-primary hover:bg-primary/90"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* Suggested Questions */}
        <div>
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-lg">Suggested Questions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {suggestedQuestions.map((question, index) => (
                <motion.button
                  key={index}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.1 }}
                  onClick={() => handleSendMessage(question)}
                  className="w-full text-left p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-sm text-foreground"
                >
                  {question}
                </motion.button>
              ))}
            </CardContent>
          </Card>

          {/* Capabilities */}
          <Card className="border-border mt-4">
            <CardHeader>
              <CardTitle className="text-lg">AI Capabilities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 mt-0.5">
                  <BookOpen className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h4 className="font-medium text-foreground text-sm">
                    Course Guidance
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Information about modules, credits, and prerequisites
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-blue-100 mt-0.5">
                  <Calendar className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <h4 className="font-medium text-foreground text-sm">
                    Smart Alerts
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Proactive warnings about attendance and deadlines
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-green-100 mt-0.5">
                  <Target className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <h4 className="font-medium text-foreground text-sm">
                    GPA Planning
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Exact SGPA targets to reach your desired CGPA or
                    classification
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
