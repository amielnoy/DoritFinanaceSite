import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Send, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { AnimatePresence, motion } from "framer-motion";
import { services } from "@/services";
import type { AgentMessage } from "@/services";
import { AgentLimitError, MAX_MESSAGE_CHARS } from "@/services/base44/Base44AgentService";

/** Everything that distinguishes one on-site agent from another. */
export interface AgentDescriptor {
  /** Agent name registered in base44/agents/. */
  agent: string;
  sectionId: string;
  sectionClassName: string;
  eyebrow: string;
  /** May contain a <br /> — rendered as two lines. */
  heading: string;
  blurb: string;
  note: string;
  panelTitle: string;
  panelSubtitle: string;
  inputLabel: string;
  greeting: string;
  conversationName: string;
  conversationDescription: string;
}

const LIMIT_COPY: Record<string, string> = {
  too_long: `ההודעה ארוכה מדי — עד ${MAX_MESSAGE_CHARS} תווים.`,
  too_many_turns: "השיחה הגיעה לאורכה המרבי. אפשר להתחיל שיחה חדשה.",
};

/**
 * One chat surface, driven entirely by its descriptor.
 *
 * This replaces three near-identical components that differed by roughly thirty
 * lines — which is why a missing aria-label on the message box had to be fixed
 * three times.
 */
export default function AgentChat({ descriptor }: { descriptor: AgentDescriptor }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([
    { role: "assistant", content: descriptor.greeting },
  ]);
  const [input, setInput] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId) return;
    return services.agents.subscribe(conversationId, setMessages);
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const ensureConversation = useCallback(async () => {
    if (conversationId) return { id: conversationId };
    const conv = await services.agents.start(descriptor.agent, {
      name: descriptor.conversationName,
      description: descriptor.conversationDescription,
    });
    setConversationId(conv.id);
    return conv;
  }, [conversationId, descriptor]);

  const say = (content: string) =>
    setMessages((m) => [...m, { role: "assistant" as const, content }]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    try {
      await services.agents.send(await ensureConversation(), text);
    } catch (e) {
      say(
        e instanceof AgentLimitError
          ? LIMIT_COPY[e.reason]
          : "מצטערת, לא הצלחתי לשלוח את ההודעה כרגע. ניתן לנסות שוב."
      );
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setConversationId(null);
    setMessages([{ role: "assistant", content: descriptor.greeting }]);
    setInput("");
  };

  const [line1, line2] = descriptor.heading.split(/<br\s*\/?>/);

  return (
    <section id={descriptor.sectionId} className={descriptor.sectionClassName}>
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-5 flex flex-col justify-center">
          <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
            {descriptor.eyebrow}
          </span>
          <h2 className="font-heading text-5xl md:text-6xl mt-5 leading-tight">
            {line1?.trim()}
            {line2 ? (
              <>
                <br />
                {line2.trim()}
              </>
            ) : null}
          </h2>
          <p className="mt-8 text-foreground/70 max-w-md leading-relaxed">{descriptor.blurb}</p>
          <div className="mt-8 flex items-start gap-3 text-sm text-foreground/60">
            <Sparkles size={18} className="text-highlight mt-0.5 shrink-0" />
            <p className="leading-relaxed">{descriptor.note}</p>
          </div>
        </div>

        <div className="lg:col-span-7 bg-card border border-border/60 flex flex-col h-[560px]">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 flex items-center justify-center border border-accent/40 font-heading text-base text-accent">
                ד
              </span>
              <div className="leading-tight">
                <p className="font-heading text-base font-bold">{descriptor.panelTitle}</p>
                <p className="text-[11px] tracking-[0.15em] uppercase text-muted-foreground">
                  {descriptor.panelSubtitle}
                </p>
              </div>
            </div>
            <button
              onClick={reset}
              aria-label="התחלה מחדש"
              className="text-muted-foreground hover:text-accent transition-colors p-2"
            >
              <RotateCcw size={16} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6 space-y-4">
            <AnimatePresence initial={false}>
              {messages.map((m, i) => {
                const isUser = m.role === "user";
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className={`flex ${isUser ? "justify-start" : "justify-end"}`}
                  >
                    <div
                      className={`max-w-[85%] px-5 py-3.5 text-[15px] leading-relaxed ${
                        isUser
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary/60 text-foreground border border-border/60"
                      }`}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      ) : (
                        <div className="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {sending && (
              <div className="flex justify-end">
                <div className="bg-secondary/60 border border-border/60 px-5 py-3.5">
                  <Loader2 size={16} className="animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
          </div>

          <div className="px-4 py-4 border-t border-border/60">
            <div className="flex items-end gap-2">
              <textarea
                aria-label={descriptor.inputLabel}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                maxLength={MAX_MESSAGE_CHARS}
                placeholder="כתבו כאן…"
                className="flex-1 bg-background border border-border px-4 py-3 text-base resize-none focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 transition-colors max-h-32"
              />
              <button
                onClick={send}
                disabled={!input.trim() || sending}
                className="inline-flex items-center justify-center w-12 h-12 bg-highlight text-primary hover:bg-highlight-strong disabled:opacity-40 disabled:hover:bg-highlight transition-colors shrink-0"
                aria-label="שליחה"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
