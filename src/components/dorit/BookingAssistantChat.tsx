import React, { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Send, Loader2, CalendarHeart, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { AnimatePresence, motion } from "framer-motion";

const AGENT_NAME = "booking_assistant";

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
  "שלום, נעים להכיר. אני כאן כדי לעזור לקבוע את פגישת ההיכרות הראשונה עם דורית — שיחה קצרה ותכליתית. באיזה נושא נרצה להיפגש? אפשר לבחור: פיננסים מיסוי וקיבוע זכויות, גמל/השתלמות/פנסיה, או ביטוחי חיים ובריאות.";

export default function BookingAssistantChat() {
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
      metadata: { name: "תיאום פגישה", description: "תיאום פגישת היכרות" },
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
    <section id="booking-assistant" className="py-24 md:py-32 border-t border-border/60 bg-secondary/30">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-5 flex flex-col justify-center">
          <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
            08 · The Direct Line
          </span>
          <h2 className="font-heading text-5xl md:text-6xl mt-5 leading-tight">
            קובעים פגישה
            <br />
            בשיחה
          </h2>
          <p className="mt-8 text-foreground/70 max-w-md leading-relaxed">
            שיחה קצרה עם העוזרת של דורית — בוחרים נושא, מועד, ומשאירים פרטים.
            הפגישה נקבעת ישירות ביומנים של דורית, והיא חוזרת לאישור סופי תוך יום עסקים.
          </p>
          <div className="mt-8 flex items-start gap-3 text-sm text-foreground/60">
            <CalendarHeart size={18} className="text-[#C4A484] mt-0.5 shrink-0" />
            <p className="leading-relaxed">
              הפרטים נשמרים אצל דורית בלבד, והתיאום המדויק נעשה איתה אישית.
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
                <p className="font-heading text-base font-bold">תיאום פגישת היכרות</p>
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