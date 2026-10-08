import React, { useCallback, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2, RotateCcw, Send, Sparkles, UserRound } from "lucide-react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
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
import { readHandoff } from "@/lib/interview-handoff";
import { leadEvents, type ChatMethod } from "@/lib/analytics";
import ContactChannels from "./ContactChannels";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { inputClass } from "@/components/dorit/primitives/Field";

/**
 * Keeps `tel:` dialable.
 *
 * react-markdown 9 sanitises hrefs against a short allow-list — http, https,
 * mailto and a few others — and silently empties everything else. The handoff
 * notice is written as markdown and offers three ways to reach Dorit; the
 * WhatsApp link is https and the mail link is mailto, so both survived, and the
 * phone number rendered as a link with `href=""`.
 *
 * On a phone that is the one that matters, and it is the whole promise of the
 * control: a person who asks for a person gets one. Found by a component test
 * asserting the href rather than the text.
 *
 * Deliberately narrow — `tel:` and nothing else beyond the library's own list.
 * The text being rendered is model output, so widening this is widening what a
 * reply can talk a visitor into opening.
 */
const allowTel = (url: string): string =>
  url.startsWith("tel:") ? url : defaultUrlTransform(url);

/** GA4's name for each chat — a technical label, never what was said in it. */
const CHAT_METHOD: Record<string, ChatMethod> = {
  needs_interview: "ai_interview",
  support_agent: "ai_support",
  procedures_agent: "ai_procedures",
  blog_recommender: "ai_blog",
};

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
  const [handoffNotice, setHandoffNotice] = useState<
    { message: string; contact: HumanContact } | null
  >(null);
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
  /** Set the moment a closing payload is accepted, so it is submitted once. */
  const submittedRef = useRef<boolean>(false);
  /** Which chat GA4 events name, by agent. */
  const chatMethod: ChatMethod = CHAT_METHOD[descriptor.agent] ?? "ai_interview";

  useEffect(() => {
    if (!conversationId) return;
    return services.agents.subscribe(conversationId, setMessages);
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  /**
   * The close of the interview, submitted by the page.
   *
   * The agent cannot do it: its tool calls are not executed in an anonymous
   * conversation, and every visitor is anonymous (A-59). It therefore states
   * the summary in a fenced block and this submits it — the same call the
   * quick-contact form has always made, which an anonymous visitor is allowed
   * to make.
   *
   * `submittedRef` rather than state: two pushes can arrive in the same tick,
   * and a second send means Dorit gets the enquiry twice.
   */
  useEffect(() => {
    if (submittedRef.current) return;
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (!last) return;
    const { summary, malformed } = readHandoff(last.content);

    if (malformed) {
      // The block was there and unusable. Saying nothing would repeat the
      // failure this exists to fix — the visitor believing they were passed on.
      submittedRef.current = true;
      console.warn("[interview] closing payload was unreadable; showing direct channels");
      showChannelsOnly();
      return;
    }
    if (!summary) return;

    submittedRef.current = true;
    void (async () => {
      try {
        const receipt = await services.leads.submitInterview(summary);
        if (!receipt?.ok) throw new Error(`rejected${receipt?.rid ? ` rid=${receipt.rid}` : ""}`);
        leadEvents.interviewCompleted();
      } catch (e) {
        // The id, where anyone can find it. It names every log line the
        // submission produced, and it is the difference between "a visitor says
        // it did not work" and one search.
        console.warn("[interview] the close was refused — showing direct channels", String(e));
        showChannelsOnly();
      }
    })();
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
  /**
   * Whose details to show when the automation stops being useful.
   *
   * The rendering belongs to `ContactChannels`. It was three markdown links
   * joined by newlines, which markdown collapses into a soft break — on a
   * phone all three came out as one cramped line, under a sentence that had
   * already named the number and the address.
   */
  const FALLBACK_CONTACT: HumanContact = CONTACT;

  /**
   * The route out that notifies nobody.
   *
   * A visitor who will not leave a number still gets דורית's, which was always
   * the promise. What it no longer does is raise an alert she cannot act on.
   */
  const showChannelsOnly = () => {
    setHandoffOpen(false);
    setHandoffError(null);
    setHandoffNotice({ message: HUMAN_HANDOFF.failure, contact: FALLBACK_CONTACT });
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
      setHandoffNotice({
        message: receipt.ok ? HUMAN_HANDOFF.confirmation : HUMAN_HANDOFF.failure,
        contact: receipt.contact,
      });
      // A lead once the request has actually reached דורית — not on opening
      // the panel (`chatHandoff`, above) and not when `escalate` itself failed.
      if (receipt.ok) leadEvents.handoffCompleted(chatMethod);
    } finally {
      setHandingOff(false);
    }
  };

  const acceptConsent = () => {
    if (!consentChecked) return;
    setConsentAt(new Date().toISOString());
    leadEvents.chatStarted(chatMethod);
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
    submittedRef.current = false;
  };

  const [line1, line2] = descriptor.heading.split(/<br\s*\/?>/);
  const started = consentAt !== null;

  const Icon = descriptor.icon;

  // The chat itself. Rendered alone when embedded, or beside the heading
  // column below when the agent is the whole section.
  const panel = (
    <div className={`${embedded ? "w-full" : "lg:col-span-7"} border border-input rounded-md shadow-sm flex flex-col h-[560px]`}>
          <div className="flex items-center justify-between px-6 py-[18px] border-b border-border gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-9 h-9 flex items-center justify-center border border-highlight text-accent shrink-0">
                <Icon size={18} aria-hidden="true" />
              </span>
              <div className="leading-tight min-w-0">
                {/* Wraps rather than truncates, for the same reason as the
                    subtitle below: the handoff and reset buttons leave this
                    column under 150px wide at 390px, where `truncate` cut
                    "ראיון היכרות" to "רא…" — unreadable, not just tight. */}
                <p className="font-heading text-[22px] font-medium">{descriptor.panelTitle}</p>
                {/* Wraps rather than truncates. At 390px this was cut to about
                    a third of its width — "עם הסוכן…" — which loses the
                    "עוזר אוטומטי" half, and that half is the disclosure that
                    the visitor is not talking to דורית. It is the one line in
                    this header doing compliance work rather than decoration.

                    The uppercase/letterspacing went with it: neither does
                    anything for Hebrew except loosen it. */}
                <p className="text-sm text-muted-foreground leading-snug">
                  {descriptor.panelSubtitle} · עוזר אוטומטי
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => {
                  setHandoffError(null);
                  if (!handoffOpen) leadEvents.chatHandoff(chatMethod);
                  setHandoffOpen((open) => !open);
                }}
                disabled={handingOff || handoffSent}
                title={HUMAN_HANDOFF.buttonTitle}
                aria-label={HUMAN_HANDOFF.buttonTitle}
                className="inline-flex items-center gap-2 min-h-11 border border-border rounded-md text-foreground hover:border-highlight hover:text-accent disabled:opacity-45 transition-colors duration-200 px-4 text-[15px]"
              >
                {handingOff ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <UserRound size={15} className="text-accent" />
                )}
                {HUMAN_HANDOFF.buttonLabel}
              </button>
              <button
                onClick={reset}
                aria-label="התחלה מחדש"
                className="w-11 h-11 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-accent transition-colors duration-200"
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </div>

          {!started ? (
            /*
             * The notice scrolls; the thing you do about it does not.
             *
             * This was one column: four paragraphs of regulatory disclosure, a
             * link, a checkbox and a button, all scrolling together. On a phone
             * the checkbox sat well below the fold, so starting a conversation
             * began with a long scroll past text most people will not read
             * twice — and some gave up before reaching it.
             *
             * Collapsing the notice would have been the easy fix and the wrong
             * one: the checkbox says "כמפורט למעלה", which stops being true the
             * moment the detail is behind a toggle. So every word stays on
             * screen and scrollable, and the action moves to a footer that is
             * always reachable. Nothing hidden, nothing to scroll past.
             */
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-7 pb-5">
                <div className="max-w-[820px] flex flex-col gap-[18px]">
                  <div className="flex flex-col gap-1">
                    <p className="font-heading text-[22px] font-medium">{CONSENT.heading}</p>
                    <p className="text-[15px] text-muted-foreground leading-[1.6]">
                      {BOT_DISCLOSURE}
                    </p>
                  </div>

                  {/* 16px and a loose leading: this is the one text on the site a
                      visitor is asked to confirm they have read, and the audience
                      skews older. It was 13.5px. The points are numbered, not
                      dashed — they are four things, in order. */}
                  <ol className="m-0 p-0 list-none flex flex-col gap-3.5 text-base leading-[1.75] text-foreground/80">
                    {(descriptor.consentPoints ?? CONSENT.points).map((point, i) => (
                      <li key={point} className="grid grid-cols-[28px_minmax(0,1fr)] gap-2">
                        <span className="font-heading text-[19px] text-accent lining-nums tabular-nums" aria-hidden="true">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ol>

                  <a
                    href={CONSENT.privacyHref}
                    className="self-start text-[15px] text-accent underline decoration-highlight/50 underline-offset-4 hover:decoration-highlight"
                  >
                    {CONSENT.privacyLinkLabel}
                  </a>
                </div>
              </div>

              <div className="shrink-0 border-t border-border px-6 py-[18px] flex flex-wrap items-center justify-between gap-4">
                {/* A 44px target, because a 16px checkbox on a phone is a miss
                    waiting to happen. The whole row is the target, not the box
                    alone — and the height is stated rather than inherited from
                    however the label happens to wrap, which on a wide screen is
                    one line and 32px. */}
                <label className="flex items-start gap-3 cursor-pointer text-[15px] leading-relaxed py-2 min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(e) => setConsentChecked(e.target.checked)}
                    className="mt-0.5 w-5 h-5 accent-highlight shrink-0"
                  />
                  <span>{CONSENT.checkboxLabel}</span>
                </label>

                <button
                  onClick={acceptConsent}
                  disabled={!consentChecked}
                  className={ctaClass("w-full sm:w-auto")}
                >
                  {CONSENT.startLabel}
                </button>
              </div>
            </div>
          ) : (
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-3.5">
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
                        className={`max-w-[min(85%,640px)] px-[18px] py-3.5 text-base leading-[1.75] rounded-md ${
                          isUser
                            ? "bg-primary text-primary-foreground rounded-br-none"
                            : "text-foreground border border-border rounded-bl-none"
                        }`}
                      >
                        {isUser ? (
                          <p className="whitespace-pre-wrap">{m.content}</p>
                        ) : (
                          <div className="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                            {/* The closing payload travels inside the message and
                                is machinery, not conversation — see
                                interview-handoff.ts. Stripped here rather than
                                on arrival so `messages` stays exactly what the
                                server sent. */}
                            <ReactMarkdown>{readHandoff(m.content).visible}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {sending && (
                <div className="flex justify-end">
                  <div className="border border-border rounded-md rounded-bl-none px-[18px] py-3.5">
                    <Loader2 size={16} className="animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>
          )}

          {handoffOpen ? (
            <div className="px-5 pb-4 pt-4 border-t border-border">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handOffToHuman("user_request");
                }}
                // Named, so it is one landmark a screen reader can jump to —
                // and so a test can address its "שם"/"טלפון" rather than the
                // contact form's, which sits in the same section.
                aria-label={HUMAN_HANDOFF.buttonTitle}
                className="border border-border rounded-md px-5 py-4"
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
                      className={inputClass("mt-1 min-h-11 px-3 py-2 text-[15px]")}
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
                      className={inputClass("mt-1 min-h-11 px-3 py-2 text-[15px] text-right")}
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
                    className={ctaClass("gap-1.5 min-h-0 px-4 py-2 text-[14px]")}
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
            <div className="px-5 pb-4 pt-4 border-t border-border">
              <div className="border border-border rounded-md px-5 py-4 text-[14px] leading-relaxed">
                <p className="text-[15px] leading-relaxed text-foreground mb-3">
                  {handoffNotice.message}
                </p>
                {/* Rows, not markdown — see ContactChannels. */}
                <ContactChannels contact={handoffNotice.contact} />
              </div>
            </div>
          ) : null}

          <div className="px-5 py-4 border-t border-border">
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
                className={inputClass("flex-1 w-auto text-[17px] resize-none max-h-32 disabled:opacity-45")}
              />
              <button
                onClick={send}
                disabled={!started || !input.trim() || sending}
                className={ctaClass("w-12 h-12 min-h-0 px-0 shrink-0 text-accent")}
                aria-label="שליחה"
              >
                <Send size={18} />
              </button>
            </div>
            <p className="mt-2.5 text-sm leading-[1.6] text-muted-foreground">
              {CHAT_DISCLAIMER}
            </p>
          </div>
        </div>
  );

  if (embedded) return panel;

  return (
    <section
      id={descriptor.sectionId}
      data-track-location={descriptor.sectionId}
      className={descriptor.sectionClassName}
    >
      {/* `md:pl-20`: `FloatingActions` is a fixed dock at `left-4` (desktop
          only), and without this reserved clearance its top button clips the
          chat panel's own left border at common desktop widths. */}
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 md:pl-20 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-5 flex flex-col justify-center">
          <Eyebrow>
            {descriptor.eyebrow}
          </Eyebrow>
          <h2 className="font-heading font-normal text-[clamp(34px,4vw,48px)] mt-5 leading-[1.12]">
            {line1?.trim()}
            {line2 ? (
              <>
                <br />
                {line2.trim()}
              </>
            ) : null}
          </h2>
          <p className="mt-8 text-foreground/70 max-w-md leading-relaxed">{descriptor.blurb}</p>
          <div className="mt-8 flex items-start gap-3 text-sm text-muted-foreground">
            <Sparkles size={18} strokeWidth={1.5} className="text-highlight mt-0.5 shrink-0" />
            <p className="leading-relaxed">{descriptor.note}</p>
          </div>

          {descriptor.tagline ? (
            <p className="mt-8 border-r border-highlight pr-[18px] font-heading text-[21px] leading-[1.6]">
              {descriptor.tagline}
            </p>
          ) : null}

          {descriptor.guardrails ? (
            <div className="mt-6 border-t border-border pt-[18px]">
              <p className="text-sm text-accent">כללי הגדר</p>
              <dl className="mt-4 space-y-3.5 text-[15px] leading-[1.7]">
                <div>
                  <dt className="text-sm text-accent">מה הוא עושה</dt>
                  <dd className="text-foreground/80">
                    {descriptor.guardrails.allowed.join(" · ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-accent">מה הוא לא עושה</dt>
                  <dd className="text-foreground/80">
                    {descriptor.guardrails.forbidden.join(" · ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-accent">מתי עובר לאדם</dt>
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
