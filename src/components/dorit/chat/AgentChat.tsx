import React, { useCallback, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2, RotateCcw, Send, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { AnimatePresence, motion } from "framer-motion";
import { services } from "@/services";
import type { AgentMessage, EscalationReason, HumanContact } from "@/services";
import { AgentLimitError, MAX_MESSAGE_CHARS } from "@/services/base44/Base44AgentService";
import {
  BOT_DISCLOSURE,
  CHAT_DISCLAIMER,
  CONSENT,
  CONSENT_VERSION,
  HUMAN_HANDOFF,
} from "@/config/compliance";
import { CONTACT } from "@/config/contact";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";

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
  /**
   * The mark in the panel header.
   *
   * Every agent used to render the same "ד", which said the one thing the
   * header must not: that these are דורית. They are separate automated
   * helpers, and a reader who tells them apart at a glance is a reader who
   * knows which one they are talking to.
   */
  icon: LucideIcon;
  /**
   * One line stating what this agent is and where it stops. Rendered beside the
   * chat, not inside it, so a visitor reads it before typing rather than after.
   */
  tagline?: string;
  /**
   * The consent points shown before this agent's chat may start.
   *
   * Defaults to the interview's, which promise that a name and a phone number
   * are collected. An agent that collects neither must not show that text — a
   * notice describing the wrong processing is worse than a generic one.
   */
  consentPoints?: readonly string[];
  /**
   * The fence, stated out loud. Publishing the boundary is half of honouring
   * it: a visitor who can see what the automation will not do is a visitor who
   * knows to ask for a person, and a reviewer can check the claim against the
   * prompt in `base44/agents/`.
   */
  guardrails?: {
    allowed: string[];
    forbidden: string[];
    handoff: string;
  };
}

// Keyed on the union rather than on `string`: `noUncheckedIndexedAccess` is
// off, so a `Record<string, string>` hands back `string` for a key that is
// not there. Add a third reason without its copy and `tsc` stays silent
// while the visitor reads a bubble saying "undefined".
const LIMIT_COPY: Record<AgentLimitError["reason"], string> = {
  too_long: `ההודעה ארוכה מדי — עד ${MAX_MESSAGE_CHARS} תווים.`,
  too_many_turns: "השיחה הגיעה לאורכה המרבי. אפשר להתחיל שיחה חדשה.",
};

/**
 * One chat surface, driven entirely by its descriptor.
 *
 * This replaces three near-identical components that differed by roughly thirty
 * lines — which is why a missing aria-label on the message box had to be fixed
 * three times.
 *
 * Two things here are regulatory rather than cosmetic, and belong in the shell
 * rather than in any one agent's prompt, because a prompt is advisory and this
 * is not: the visitor cannot send a first message before accepting the consent
 * notice, and the route to a human is a button that is present from the first
 * frame — not something that depends on the model choosing to offer it.
 */
export default function AgentChat({
  descriptor,
  embedded = false,
}: {
  descriptor: AgentDescriptor;
  /**
   * Render the chat panel alone, at full width, with no section around it.
   *
   * The split layout puts the heading in a column beside the chat, which is
   * right when the agent *is* the section. On the home page's "נתחיל בשיחה
   * קצרה" the section owns the heading and carries other ways to make contact
   * beneath it, so the chat takes the width of the page and nothing else.
   */
  embedded?: boolean;
}) {
  const [consentAt, setConsentAt] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState<boolean>(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([
    { role: "assistant", content: descriptor.greeting },
  ]);
  const [input, setInput] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [handingOff, setHandingOff] = useState<boolean>(false);
  /**
   * The handoff reply, kept separately from `messages` and rendered outside
   * both branches of the panel.
   *
   * Two reasons, and the second is the one that was broken. A visitor may press
   * "talk to a person" before accepting the notice — that is the whole point of
   * putting the control outside the gate — and at that moment the transcript is
   * not on screen to answer into. And after consent, `messages` is replaced
   * wholesale by every server push, so a notice written into the transcript is
   * erased by the next one. Since the transcript is exactly where the phone
   * number used to live post-consent, the documented promise — a person who
   * asked for a person gets one even when the backend is down — quietly did not
   * hold in the common case. State the panel owns, rendered in both states,
   * holds it in both.
   */
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  /**
   * The handoff asks who to call back before it notifies anyone.
   *
   * It used to fire on the press: `escalate` was called with a reason, a
   * transcript and nothing else, because at that moment the panel holds no name
   * and no phone — those live in the conversation with the agent, if they were
   * given at all. On 2026-10-02 a visitor on Android pressed it three times
   * mid-interview and דורית received three notifications reading
   * `שם: לא נמסר · טלפון: לא נמסר`. Someone wanted to talk to her and she had
   * no way to reach them. See A-55.
   *
   * `handoffSent` is why the third press now changes nothing: the control
   * re-enabled itself in `finally`, so each press was another empty mail.
   */
  const [handoffOpen, setHandoffOpen] = useState<boolean>(false);
  const [handoffName, setHandoffName] = useState<string>("");
  const [handoffPhone, setHandoffPhone] = useState<string>("");
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [handoffSent, setHandoffSent] = useState<boolean>(false);
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
      // Recorded on the conversation so a stored enquiry can always be tied to
      // the exact notice the visitor was shown.
      consent_version: CONSENT_VERSION,
      consent_at: consentAt ?? "",
    });
    setConversationId(conv.id);
    return conv;
  }, [conversationId, consentAt, descriptor]);

  const say = (content: string) =>
    setMessages((m) => [...m, { role: "assistant" as const, content }]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending || !consentAt) return;
    setSending(true);
    setInput("");
    try {
      await services.agents.send(await ensureConversation(), text);
    } catch (e) {
      // Put the text back in the box. The visitor's own message reaches the
      // transcript only by way of the server echoing it, so a failed send
      // leaves it nowhere at all: cleared from the input, absent from the
      // conversation, one line of apology in its place. That is the difference
      // between "try again" and "this site ate what I wrote".
      setInput(text);
      say(
        e instanceof AgentLimitError
          ? LIMIT_COPY[e.reason]
          : "מצטערת, לא הצלחתי לשלוח את ההודעה כרגע. ניתן לנסות שוב."
      );
    } finally {
      setSending(false);
    }
  };

  /**
   * The visitor-initiated route out of the automation.
   *
   * It records the request and notifies דורית, but it renders the direct
   * channels either way — a person who asked for a person gets one even when
   * the backend is down.
   */
  /** The direct channels, formatted once for both routes out. */
  const FALLBACK_CONTACT: HumanContact = CONTACT;

  const channelsOf = ({ phoneDisplay, phoneE164, whatsapp, email }: HumanContact) =>
    [
      `📞 [${phoneDisplay}](tel:${phoneE164})`,
      `💬 [וואטסאפ](https://wa.me/${whatsapp})`,
      `✉️ [${email}](mailto:${email})`,
    ].join("\n");

  /**
   * The route out that notifies nobody.
   *
   * A visitor who will not leave a number still gets דורית's, which was always
   * the promise. What it no longer does is raise an alert she cannot act on.
   */
  const showChannelsOnly = () => {
    setHandoffOpen(false);
    setHandoffError(null);
    setHandoffNotice([HUMAN_HANDOFF.failure, "", channelsOf(FALLBACK_CONTACT)].join("\n"));
  };

  const handOffToHuman = async (reason: EscalationReason = "user_request") => {
    if (handingOff || handoffSent) return;
    const name = handoffName.trim();
    const phone = handoffPhone.trim();
    // A handoff without a number is the bug, not a lesser version of the
    // feature: it reaches דורית as someone who wants to talk and cannot be
    // talked to. The visitor keeps the other door — `showChannelsOnly`.
    if (!phone) {
      setHandoffError(HUMAN_HANDOFF.phoneError);
      return;
    }
    setHandoffError(null);
    setHandingOff(true);
    const transcript = messages
      .slice(-6)
      .map((m) => `${m.role === "user" ? "מבקר" : "סוכן"}: ${m.content}`)
      .join("\n");
    try {
      const receipt = await services.support.escalate({
        reason,
        summary: `בקשה מהאתר למעבר לטיפול אנושי (${descriptor.conversationName}).\n\n${transcript}`,
        agent: descriptor.agent,
        name,
        phone,
        consentVersion: CONSENT_VERSION,
        consentAt: consentAt ?? "",
      });
      setHandoffSent(true);
      setHandoffOpen(false);
      setHandoffNotice(
        [
          receipt.ok ? HUMAN_HANDOFF.confirmation : HUMAN_HANDOFF.failure,
          "",
          channelsOf(receipt.contact),
        ].join("\n")
      );
    } finally {
      setHandingOff(false);
    }
  };

  const acceptConsent = () => {
    if (!consentChecked) return;
    setConsentAt(new Date().toISOString());
  };

  const reset = () => {
    setConversationId(null);
    setMessages([{ role: "assistant", content: descriptor.greeting }]);
    setInput("");
    setHandoffNotice(null);
    setHandoffOpen(false);
    setHandoffName("");
    setHandoffPhone("");
    setHandoffError(null);
    setHandoffSent(false);
  };

  const [line1, line2] = descriptor.heading.split(/<br\s*\/?>/);
  const started = consentAt !== null;

  const Icon = descriptor.icon;

  // The chat itself. Rendered alone when embedded, or beside the heading
  // column below when the agent is the whole section.
  const panel = (
    <div className={`${embedded ? "w-full" : "lg:col-span-7"} bg-card border border-border/60 flex flex-col h-[560px]`}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-9 h-9 flex items-center justify-center border border-accent/40 text-accent shrink-0">
                <Icon size={18} aria-hidden="true" />
              </span>
              <div className="leading-tight min-w-0">
                <p className="font-heading text-base font-bold truncate">{descriptor.panelTitle}</p>
                {/* Wraps rather than truncates. At 390px this was cut to about
                    a third of its width — "עם הסוכן…" — which loses the
                    "עוזר אוטומטי" half, and that half is the disclosure that
                    the visitor is not talking to דורית. It is the one line in
                    this header doing compliance work rather than decoration.

                    The uppercase/letterspacing went with it: neither does
                    anything for Hebrew except loosen it. */}
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {descriptor.panelSubtitle} · עוזר אוטומטי
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => {
                  setHandoffError(null);
                  setHandoffOpen((open) => !open);
                }}
                disabled={handingOff || handoffSent}
                title={HUMAN_HANDOFF.buttonTitle}
                aria-label={HUMAN_HANDOFF.buttonTitle}
                className="inline-flex items-center gap-1.5 border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-40 transition-colors px-3 py-2 text-[13px]"
              >
                {handingOff ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <UserRound size={14} />
                )}
                {HUMAN_HANDOFF.buttonLabel}
              </button>
              <button
                onClick={reset}
                aria-label="התחלה מחדש"
                className="text-muted-foreground hover:text-accent transition-colors p-2"
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </div>

          {!started ? (
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="flex items-start gap-3">
                <ShieldCheck size={18} className="text-accent mt-0.5 shrink-0" />
                <div>
                  <p className="font-heading text-lg font-bold">{CONSENT.heading}</p>
                  <p className="text-[13px] text-muted-foreground mt-1">{BOT_DISCLOSURE}</p>
                </div>
              </div>

              <ul className="mt-5 space-y-3 text-[13.5px] leading-relaxed text-foreground/75">
                {(descriptor.consentPoints ?? CONSENT.points).map((point) => (
                  <li key={point} className="flex gap-2.5">
                    <span className="text-accent shrink-0">—</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>

              <a
                href={CONSENT.privacyHref}
                className="inline-block mt-4 text-[13px] text-accent hover:underline underline-offset-4"
              >
                {CONSENT.privacyLinkLabel}
              </a>

              <label className="flex items-start gap-3 mt-6 cursor-pointer text-[14px] leading-relaxed">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-[var(--accent)] shrink-0"
                />
                <span>{CONSENT.checkboxLabel}</span>
              </label>

              <button
                onClick={acceptConsent}
                disabled={!consentChecked}
                className="mt-6 px-6 py-3 bg-highlight text-primary hover:bg-highlight-strong disabled:opacity-40 disabled:hover:bg-highlight transition-colors text-[15px]"
              >
                {CONSENT.startLabel}
              </button>
            </div>
          ) : (
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
          )}

          {handoffOpen ? (
            <div className="px-5 pb-4 pt-4 border-t border-border/60">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handOffToHuman("user_request");
                }}
                // Named, so it is one landmark a screen reader can jump to —
                // and so a test can address its "שם"/"טלפון" rather than the
                // contact form's, which sits in the same section.
                aria-label={HUMAN_HANDOFF.buttonTitle}
                className="border border-accent/40 bg-secondary/30 px-5 py-4"
              >
                <p className="text-[14px] leading-relaxed mb-3">{HUMAN_HANDOFF.prompt}</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="flex-1 text-[12px] text-muted-foreground">
                    {HUMAN_HANDOFF.nameLabel}
                    <input
                      value={handoffName}
                      onChange={(e) => setHandoffName(e.target.value)}
                      placeholder={HUMAN_HANDOFF.namePlaceholder}
                      autoComplete="name"
                      className="mt-1 w-full border border-border bg-background px-3 py-2 text-[15px] text-foreground"
                    />
                  </label>
                  <label className="flex-1 text-[12px] text-muted-foreground">
                    {HUMAN_HANDOFF.phoneLabel}
                    {/* `tel` so a phone offers the number pad, and `dir=ltr` so
                        the digits do not reorder inside an RTL panel. */}
                    <input
                      type="tel"
                      inputMode="tel"
                      dir="ltr"
                      value={handoffPhone}
                      onChange={(e) => setHandoffPhone(e.target.value)}
                      placeholder={HUMAN_HANDOFF.phonePlaceholder}
                      autoComplete="tel"
                      aria-invalid={handoffError ? true : undefined}
                      className="mt-1 w-full border border-border bg-background px-3 py-2 text-[15px] text-foreground text-right"
                    />
                  </label>
                </div>
                {handoffError ? (
                  <p role="alert" className="mt-2 text-[13px] text-destructive">
                    {handoffError}
                  </p>
                ) : null}
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={handingOff}
                    className="inline-flex items-center gap-1.5 bg-accent text-accent-foreground disabled:opacity-40 px-4 py-2 text-[14px]"
                  >
                    {handingOff ? <Loader2 size={14} className="animate-spin" /> : null}
                    {HUMAN_HANDOFF.submitLabel}
                  </button>
                  <button
                    type="button"
                    onClick={showChannelsOnly}
                    className="text-[13px] text-muted-foreground underline hover:text-accent transition-colors"
                  >
                    {HUMAN_HANDOFF.skipLabel}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {handoffNotice ? (
            <div className="px-5 pb-4 pt-4 border-t border-border/60">
              <div className="border border-accent/40 bg-secondary/40 px-5 py-4 text-[14px] leading-relaxed">
                <div className="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                  <ReactMarkdown>{handoffNotice}</ReactMarkdown>
                </div>
              </div>
            </div>
          ) : null}

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
                disabled={!started}
                placeholder={started ? "כתבו כאן…" : "יש לאשר את ההסכמה כדי להתחיל"}
                className="flex-1 bg-background border border-border px-4 py-3 text-base resize-none focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 transition-colors max-h-32 disabled:opacity-50"
              />
              <button
                onClick={send}
                disabled={!started || !input.trim() || sending}
                className="inline-flex items-center justify-center w-12 h-12 bg-highlight text-primary hover:bg-highlight-strong disabled:opacity-40 disabled:hover:bg-highlight transition-colors shrink-0"
                aria-label="שליחה"
              >
                <Send size={18} />
              </button>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              {CHAT_DISCLAIMER}
            </p>
          </div>
        </div>
  );

  if (embedded) return panel;

  return (
    <section id={descriptor.sectionId} className={descriptor.sectionClassName}>
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-5 flex flex-col justify-center">
          <Eyebrow>
            {descriptor.eyebrow}
          </Eyebrow>
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

          {descriptor.tagline ? (
            <p className="mt-8 border-r-2 border-accent pr-4 font-heading text-[17px] leading-relaxed text-foreground/85">
              {descriptor.tagline}
            </p>
          ) : null}

          {descriptor.guardrails ? (
            <div className="mt-6 border border-border/60 bg-secondary/30 px-5 py-5">
              <p className="text-[11px] tracking-[0.12em] text-accent">כללי הגדר</p>
              <dl className="mt-4 space-y-3.5 text-[13.5px] leading-relaxed">
                <div>
                  <dt className="text-foreground/50">מה הוא עושה</dt>
                  <dd className="text-foreground/80">
                    {descriptor.guardrails.allowed.join(" · ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-foreground/50">מה הוא לא עושה</dt>
                  <dd className="text-foreground/80">
                    {descriptor.guardrails.forbidden.join(" · ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-foreground/50">מתי עובר לאדם</dt>
                  <dd className="text-foreground/80">{descriptor.guardrails.handoff}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </div>

        {panel}
      </div>
    </section>
  );
}
