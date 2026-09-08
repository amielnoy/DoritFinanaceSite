import React, { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Send, Loader2, BookOpen, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";

const AGENT_NAME = "blog_recommender";

interface Message {
  role: "user" | "assistant";
  content: string;
  tool_calls?: Array<{
    name: string;
    status: string;
    arguments_string?: string;
    results?: string;
    display_projection?: { hide_details?: boolean; details_redacted?: boolean; label?: string; active_label?: string; error_label?: string };
  }>;
}

const INITIAL_GREETING =
  "שלום. אני כאן כדי להמליץ לך על מאמרים רלוונטיים מהבלוג של דורית. באיזה נושא פיננסי מעניין אותך לקרוא? למשל: פנסיה, גמל והשתלמות, מיסוי, קיבוע זכויות, ביטוחי חיים ובריאות, דמי ניהול, פרישה.";

// Renders assistant content with /blog/<id> links converted to internal Links
function AssistantContent({ content }: { content: string }) {
  const parts = content.split(/(\/blog\/[a-zA-Z0-9_-]+)/g);
  return (
    <div className="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            if (href && href.startsWith("/blog/")) {
              return <Link to={href} className="text-accent underline underline-offset-2 hover:text-[#C4A484]">{children}</Link>;
            }
            return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function BlogRecommenderChat() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: INITIAL_GREETING },
  ]);
  const [input, setInput] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId) return;
    const unsubscribe = base44.agents.subscribeToConversation(conversationId, (data: any) => {
      setMessages(data.messages || []);
    });
    return () => unsubscribe();
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const ensureConversation = async () => {
    if (conversationId) return conversationId;
    const conv = await base44.agents.createConversation({
      agent_name: AGENT_NAME,
      metadata: { name: "המלצות קריאה", description: "המלצות מאמרים לפי נושא" },
    });
    setConversationId(conv.id);
    return conv.id;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    try {
      const conv = await base44.agents.getConversation(await ensureConversation());
      await base44.agents.addMessage(conv, { role: "user", content: text });
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "מצטערת, לא הצלחתי לשלוח את ההודעה כרגע. ניתן לנסות שוב." },
      ]);
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setConversationId(null);
    setMessages([{ role: "assistant", content: INITIAL_GREETING }]);
    setInput("");
  };

  return (
    <section id="blog-recommender" className="py-24 md:py-32 border-t border-border/60">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-5 flex flex-col justify-center">
          <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
            09 · The Reading
          </span>
          <h2 className="font-heading text-5xl md:text-6xl mt-5 leading-tight">
            מה
            <br />
            לקרוא?
          </h2>
          <p className="mt-8 text-foreground/70 max-w-md leading-relaxed">
            ספרו בקצרה על הדאגה או הסקרנות הפיננסית שלכם, והעוזרת של דורית
            תמליץ על המאמרים הרלוונטיים ביותר מהבלוג — מותאמים אישית לשאלה שלכם.
          </p>
          <div className="mt-8 flex items-start gap-3 text-sm text-foreground/60">
            <BookOpen size={18} className="text-[#C4A484] mt-0.5 shrink-0" />
            <p className="leading-relaxed">
              המלצות מדויקות, על בסיס תוכן המאמרים שכבר פורסמו.
            </p>
          </div>
        </div>

        <div className="lg:col-span-7 bg-card border border-border/60 flex flex-col h-[560px]">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 flex items-center justify-center border border-accent/40 font-heading text-base text-accent">
                ד
              </span>
              <div className="leading-tight">
                <p className="font-heading text-base font-bold">המלצות קריאה</p>
                <p className="text-[11px] tracking-[0.15em] uppercase text-muted-foreground">
                  עם העוזרת של דורית
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
                        <AssistantContent content={m.content} />
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
                aria-label="הודעה לסוכן המלצות התוכן"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="כתבו כאן…"
                className="flex-1 bg-background border border-border px-4 py-3 text-base resize-none focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 transition-colors max-h-32"
              />
              <button
                onClick={send}
                disabled={!input.trim() || sending}
                className="inline-flex items-center justify-center w-12 h-12 bg-[#C4A484] text-primary hover:bg-[#b8916f] disabled:opacity-40 disabled:hover:bg-[#C4A484] transition-colors shrink-0"
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