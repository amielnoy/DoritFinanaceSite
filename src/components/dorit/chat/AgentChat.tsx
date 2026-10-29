import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleCheck, CircleX, ChevronDown, Loader2, MessageCircle, RotateCcw, Send, Sparkles, UserRound, X } from "lucide-react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { AnimatePresence, motion } from "framer-motion";
import { services } from "@/services";
import type { AgentMessage, EscalationReason, HumanContact } from "@/services";
import { AgentLimitError, AgentUnavailableError, MAX_MESSAGE_CHARS } from "@/services/agent-errors";
import {
  BOT_DISCLOSURE,
  CHAT_DISCLAIMER,
  CHAT_FUNCTION_CONSENT_POINTS,
  CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT,
  CHAT_FUNCTION_CONSENT_VERSION,
  CONSENT,
  HUMAN_HANDOFF,
} from "@/config/compliance";
import { CONTACT } from "@/config/contact";
import { readHandoff } from "@/lib/interview-handoff";
import { readRecommendation } from "@/lib/blog-recommendation";
import { articlePath } from "@/lib/articlePath";
import { getAttribution } from "@/lib/attribution";
import { leadEvents, type ChatMethod } from "@/lib/analytics";
import ContactChannels from "./ContactChannels";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { inputClass } from "@/components/dorit/primitives/Field";
import { MD_UP, useMediaQuery } from "@/hooks/useMediaQuery";

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

/**
 * An article link by record id: `/blog/<record id>`, which the Base44 agents
 * wrote because their BlogPost had no slug, and which reaches the article only
 * through the 301 to the slug (D-10, manual test 2026-10-14). The chat
 * function's agents link by slug; a reply that still names an id is shown the
 * slug's address, once the chat knows it.
 */
const LEGACY_ARTICLE_LINK = /^\/blog\/([0-9a-f]{24})$/;
const hasLegacyArticleLink = (text: string) => /\]\(\/blog\/[0-9a-f]{24}\)/.test(text);

/** GA4's name for each chat — a technical label, never what was said in it. */
const CHAT_METHOD: Record<string, ChatMethod> = {
  needs_interview: "ai_interview",
  support_agent: "ai_support",
  procedures_agent: "ai_procedures",
  blog_recommender: "ai_blog",
};

/** Everything that distinguishes one on-site agent from another. */
export interface AgentDescriptor {
  /** Agent name the `chat` function serves (supabase/functions/chat/prompts/). */
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
   * The v5 consent points this agent's v6 notice is built from
   * (`CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT` in compliance.ts). The chat shows
   * the v6 notice, never these alone.
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
   * prompt in `supabase/functions/chat/prompts/`.
   */
  guardrails?: {
    allowed: string[];
    forbidden: string[];
    handoff: string;
  };
  /**
   * Below `md`, show a short card that opens the chat full-screen, instead of
   * the chat itself at a fixed 560px.
   *
   * A 560px box on an 844px phone left the messages about 100px between a
   * header that wrapped one word per line and an input pinned under it, and
   * the box scrolled inside a page that scrolled too. On a phone the chat is
   * now a layer of its own, the height of the screen; on a desktop nothing
   * changes. Opt-in per agent, because the interview on the home page is
   * embedded in a flow of its own and is not this shape.
   */
  mobileSheet?: {
    /** The one sentence under the heading on the card. */
    cardText: string;
    /** The full-width button that opens the layer. */
    openLabel: string;
    /** The layer's header, on one line. */
    layerTitle: string;
    /** Under the title, never wrapped: the disclosure that this is not Dorit. */
    layerSubtitle: string;
    /** The closed <details> that holds the blurb, the note and the fence. */
    detailsLabel: string;
  };
}

// Keyed on the union rather than on `string`: `noUncheckedIndexedAccess` is
// off, so a `Record<string, string>` hands back `string` for a key that is
// not there. Add a third reason without its copy and `tsc` stays silent
// while the visitor reads a bubble saying "undefined".
const LIMIT_COPY: Record<AgentLimitError["reason"], string> = {
  too_long: `ההודעה ארוכה מדי — עד ${MAX_MESSAGE_CHARS} תווים.`,
  too_many_turns: "השיחה הגיעה לאורכה המרבי. אפשר להתחיל שיחה חדשה.",
  // Raised only by the chat function's adapter.
  rate_limited: "נשלחו הרבה הודעות בזמן קצר. אפשר לנסות שוב בעוד דקה.",
  conversation_closed: "השיחה הזו הסתיימה. אפשר להתחיל שיחה חדשה.",
  // Raised only by the chat function's adapter: one message per conversation at a time.
  busy: "הודעה קודמת עדיין בטיפול — רגע אחד.",
  // Raised only by the chat function's adapter: received, its answer still being written.
  still_processing: "ההודעה התקבלה ועדיין בטיפול. התשובה מתעכבת — אפשר לכתוב שוב בעוד דקה.",
};

/** What Tab may land on inside the full-screen layer. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

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
  onAssistantMessage,
  initialInput,
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
  /**
   * Called once per new assistant message, with its raw content (before any
   * block is stripped). Generic on purpose: this component knows nothing
   * about any one agent's structured output — a caller that cares (e.g. the
   * blog page reading a `recommended` block, see blog-recommendation.ts)
   * parses it itself.
   */
  onAssistantMessage?: (content: string) => void;
  /**
   * Text a visitor already typed elsewhere on the page, placed in the input.
   * Never sent on their behalf: the consent gate still stands between it and
   * the agent, and the visitor presses send themselves.
   */
  initialInput?: string;
}) {
  const [consentAt, setConsentAt] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState<boolean>(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([
    { role: "assistant", content: descriptor.greeting },
  ]);
  const [input, setInput] = useState<string>(initialInput ?? "");
  const [sending, setSending] = useState<boolean>(false);
  // Read only once a reply carries an old-style article link, and once: a
  // failed read leaves the old address, which still reaches the article.
  const [articlePaths, setArticlePaths] = useState<Map<string, string> | null>(null);
  const needsArticlePaths = messages.some((m) => m.role === "assistant" && hasLegacyArticleLink(m.content));
  useEffect(() => {
    if (!needsArticlePaths || articlePaths) return;
    let live = true;
    Promise.resolve()
      .then(() => services.content.listArticles())
      .then((list) => {
        if (live) setArticlePaths(new Map(list.map((a) => [a.id, articlePath(a)])));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [needsArticlePaths, articlePaths]);
  const chatHref = (href: string | undefined) => {
    const id = href?.match(LEGACY_ARTICLE_LINK)?.[1];
    return (id && articlePaths?.get(id)) || href;
  };
  useEffect(() => {
    if (initialInput) setInput(initialInput);
  }, [initialInput]);
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
  /** Below md with `mobileSheet`: whether the chat is open as a full-screen layer. */
  const [layerOpen, setLayerOpen] = useState<boolean>(false);
  /** The visual viewport while the layer is open — the screen less the keyboard. */
  const [visibleBox, setVisibleBox] = useState<{ height: number; top: number } | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const layerTitleId = useId();
  /** Set the moment the reply that saved the lead arrives, so it is counted once. */
  const submittedRef = useRef<boolean>(false);
  /** The last assistant message already handed to `onAssistantMessage`, so a
   *  user message appended after it does not report the same content twice. */
  const lastReportedRef = useRef<string>("");
  /** Which chat GA4 events name, by agent. */
  const chatMethod: ChatMethod = CHAT_METHOD[descriptor.agent] ?? "ai_interview";

  /** Every agent is on the `chat` function: its v6 notice, stamped with the v6 version. */
  const consentVersion = CHAT_FUNCTION_CONSENT_VERSION;
  const consentPoints = CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT[descriptor.agent] ?? CHAT_FUNCTION_CONSENT_POINTS;

  useEffect(() => {
    if (!conversationId) return;
    return services.agents.subscribe(conversationId, setMessages);
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  /**
   * Each conversation this panel shows, numbered, and the send in flight
   * (review 2026-10-15). Reset and unmount move to the next number and abort
   * the send — its request and its status polling — and whatever an earlier
   * number's send finishes with touches nothing on screen.
   */
  const generationRef = useRef(0);
  const inFlightRef = useRef<AbortController | null>(null);
  const abandonSend = () => {
    generationRef.current += 1;
    inFlightRef.current?.abort();
    inFlightRef.current = null;
  };

  useEffect(() => () => abandonSend(), []);

  /**
   * The close of the interview. The `chat` function saves the lead itself;
   * the reply that saved it says so, and the page only counts it.
   *
   * `submittedRef` rather than state: two pushes can arrive in the same tick,
   * and a second count is a second lead in GA4.
   */
  useEffect(() => {
    if (submittedRef.current) return;
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (last?.signal !== "lead_saved") return;
    submittedRef.current = true;
    leadEvents.interviewCompleted();
    // Saved, but the reply that would have said so was lost: the confirmation, and her channels for anything else.
    if (last.replyMissing) setHandoffNotice({ message: HUMAN_HANDOFF.reachHer, contact: FALLBACK_CONTACT });
  }, [messages]);

  useEffect(() => {
    if (!onAssistantMessage) return;
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (!last || last.content === lastReportedRef.current) return;
    lastReportedRef.current = last.content;
    onAssistantMessage(last.content);
  }, [messages, onAssistantMessage]);

  const ensureConversation = useCallback(async () => {
    if (conversationId) return { id: conversationId };
    const generation = generationRef.current;
    const conv = await services.agents.start(descriptor.agent, {
      name: descriptor.conversationName,
      description: descriptor.conversationDescription,
      // Recorded on the conversation so a stored enquiry can always be tied to
      // the exact notice the visitor was shown.
      consent_version: consentVersion,
      consent_at: consentAt ?? "",
      // The function stores these on the conversation.
      channel: getAttribution()?.channel ?? "",
      campaign: getAttribution()?.campaign ?? "",
      landing_path: window.location.pathname,
    });
    // Opened for a conversation the visitor has since reset: not this panel's.
    if (generation === generationRef.current) setConversationId(conv.id);
    return conv;
  }, [conversationId, consentAt, descriptor, consentVersion]);

  const say = (content: string) =>
    setMessages((m) => [...m, { role: "assistant" as const, content }]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending || !consentAt) return;
    setSending(true);
    setInput("");
    // No reply watchdog: the reply arrives with the send itself, the adapter
    // times out at 40 s and the function's own budget is 25 s.
    const generation = generationRef.current;
    const controller = new AbortController();
    inFlightRef.current = controller;
    try {
      const conversation = await ensureConversation();
      if (generation !== generationRef.current) return;
      await services.agents.send(conversation, text, { signal: controller.signal });
    } catch (e) {
      // A send the visitor abandoned (reset): the panel shows another conversation now.
      if (generation !== generationRef.current) return;
      // Put the text back in the box. The visitor's own message reaches the
      // transcript only by way of the server echoing it, so a failed send
      // leaves it nowhere at all: cleared from the input, absent from the
      // conversation, one line of apology in its place. That is the difference
      // between "try again" and "this site ate what I wrote". A message still
      // being answered did arrive, and stays in the transcript: not handed back.
      if (!(e instanceof AgentLimitError && e.reason === "still_processing")) setInput(text);
      if (e instanceof AgentUnavailableError) {
        showChannelsOnly();
        return;
      }
      say(
        e instanceof AgentLimitError
          ? LIMIT_COPY[e.reason]
          : "מצטערת, לא הצלחתי לשלוח את ההודעה כרגע. ניתן לנסות שוב."
      );
    } finally {
      if (inFlightRef.current === controller) inFlightRef.current = null;
      if (generation === generationRef.current) setSending(false);
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
      const handoffAttribution = getAttribution();
      const receipt = await services.support.escalate({
        reason,
        summary: `בקשה מהאתר למעבר לטיפול אנושי (${descriptor.conversationName}).\n\n${transcript}`,
        agent: descriptor.agent,
        name,
        phone,
        consentVersion,
        consentAt: consentAt ?? "",
        channel: handoffAttribution?.channel,
        campaign: handoffAttribution?.campaign ?? undefined,
        landingPath: window.location.pathname,
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
    abandonSend();
    setSending(false);
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

  /*
   * Below md, an agent with `mobileSheet` is a card on the page and a layer
   * over it. `sheet` is null on a desktop, for an embedded chat and for an
   * agent without it — and then everything below renders exactly as before.
   *
   * The layer is this same panel, restyled, not a copy: the conversation, the
   * consent and a half-typed message survive closing and reopening it. It stays
   * inside the section, so `#support-chat` still finds the chat and a click
   * inside it is still located there for GA4. That relies on no ancestor
   * carrying a transform, which would make `fixed` relative to it.
   */
  const isDesktop = useMediaQuery(MD_UP, true);
  const sheet = descriptor.mobileSheet && !embedded && !isDesktop ? descriptor.mobileSheet : null;
  const asLayer = sheet !== null && layerOpen;

  // A phone turned past md is laid out as a desktop: the chat goes back in place.
  useEffect(() => {
    if (isDesktop) setLayerOpen(false);
  }, [isDesktop]);

  useEffect(() => {
    if (!asLayer) return;
    const opener = openerRef.current;
    const layer = layerRef.current;
    const html = document.documentElement;
    const before = { html: html.style.overflow, body: document.body.style.overflow };
    // One scroll at a time: the page behind the layer stays where it was.
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    // The dialog itself, not the message box: focusing a field would raise the
    // phone's keyboard over the consent notice before it has been read.
    layer?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setLayerOpen(false);
        return;
      }
      if (e.key !== "Tab" || !layer) return;
      const items = Array.from(layer.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0,
      );
      // Every Tab is moved here rather than left to the browser: Safari's
      // default Tab skips buttons and links, so from the dialog itself it
      // jumped straight out of the layer to a field on the page behind it.
      e.preventDefault();
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const step = e.shiftKey ? -1 : 1;
      const next = at === -1 ? (e.shiftKey ? items.length - 1 : 0) : (at + step + items.length) % items.length;
      items[next].focus();
    };
    document.addEventListener("keydown", onKey);

    // The input stays above the keyboard: iOS shrinks the visual viewport, not
    // the layout one `fixed` is measured against, so 100dvh alone would leave
    // the message box under the keyboard.
    const vv = window.visualViewport;
    const fit = () => {
      if (vv) setVisibleBox({ height: Math.round(vv.height), top: Math.round(vv.offsetTop) });
    };
    fit();
    vv?.addEventListener("resize", fit);
    vv?.addEventListener("scroll", fit);

    return () => {
      document.removeEventListener("keydown", onKey);
      vv?.removeEventListener("resize", fit);
      vv?.removeEventListener("scroll", fit);
      html.style.overflow = before.html;
      document.body.style.overflow = before.body;
      setVisibleBox(null);
      opener?.focus();
    };
  }, [asLayer]);

  /** The route to a person, in the panel's header and in the layer's. */
  const handoffButton = (compact: boolean) => (
    <button
      onClick={() => {
        setHandoffError(null);
        if (!handoffOpen) leadEvents.chatHandoff(chatMethod);
        setHandoffOpen((open) => !open);
      }}
      disabled={handingOff || handoffSent}
      title={HUMAN_HANDOFF.buttonTitle}
      aria-label={HUMAN_HANDOFF.buttonTitle}
      aria-expanded={compact ? handoffOpen : undefined}
      className={
        compact
          ? "inline-flex items-center gap-1.5 min-h-11 shrink-0 whitespace-nowrap border border-border rounded-md text-foreground hover:border-highlight hover:text-accent disabled:opacity-45 transition-colors duration-200 px-3 text-[15px]"
          : "inline-flex items-center gap-2 min-h-11 border border-border rounded-md text-foreground hover:border-highlight hover:text-accent disabled:opacity-45 transition-colors duration-200 px-4 text-[15px]"
      }
    >
      {handingOff ? (
        <Loader2 size={15} className="animate-spin" />
      ) : compact ? null : (
        <UserRound size={15} className="text-accent" />
      )}
      {HUMAN_HANDOFF.buttonLabel}
    </button>
  );

  const resetButton = (
    <button
      onClick={reset}
      aria-label="התחלה מחדש"
      className="w-11 h-11 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-accent transition-colors duration-200"
    >
      <RotateCcw size={16} />
    </button>
  );

  /** "כללי הגדר" — beside the chat on a desktop, inside the card's <details> on a phone. */
  const fence = (className: string) =>
    descriptor.guardrails ? (
      <div className={className}>
        <p className="font-heading font-bold text-[17px]">כללי הגדר</p>
        <dl className="mt-4 space-y-3 text-[15px] leading-[1.7]">
          <div className={FENCE_CARD}>
            <dt className="flex items-center gap-2 text-sm font-semibold text-accent">
              <CircleCheck size={16} aria-hidden="true" />
              מה הוא עושה
            </dt>
            <dd className="mt-1 text-foreground/80">
              {descriptor.guardrails.allowed.join(" · ")}
            </dd>
          </div>
          <div className={FENCE_CARD}>
            <dt className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <CircleX size={16} aria-hidden="true" />
              מה הוא לא עושה
            </dt>
            <dd className="mt-1 text-foreground/80">
              {descriptor.guardrails.forbidden.join(" · ")}
            </dd>
          </div>
          <div className={FENCE_CARD}>
            <dt className="flex items-center gap-2 text-sm font-semibold text-accent">
              <UserRound size={16} aria-hidden="true" />
              מתי עובר לאדם
            </dt>
            <dd className="mt-1 text-foreground/80">{descriptor.guardrails.handoff}</dd>
          </div>
        </dl>
      </div>
    ) : null;

  const panelClass = asLayer
    ? "fixed inset-x-0 top-0 z-[100] h-[100dvh] flex flex-col overflow-y-auto overscroll-contain bg-background outline-none"
    : sheet
      ? "hidden"
      : `${embedded ? "w-full" : "lg:col-span-7"} border border-input rounded-2xl bg-card shadow-sm flex flex-col h-[560px] overflow-y-auto`;

  // The chat itself. Rendered alone when embedded, or beside the heading
  // column below when the agent is the whole section.
  const panel = (
    // `overflow-y-auto`: the box is a fixed 560px, but a visitor can open the
    // hand-off panel before accepting the consent notice — "בלי שאלות סינון"
    // (compliance §5) means that button is never gated on it. Header + the
    // full notice + the hand-off form + the standing disclaimer together
    // overflow 560px, and without this the notice's own flex-1 region was
    // squeezed to zero height by the sibling it had no room left for, its
    // text rendering on top of the hand-off form's instead of being cut off
    // or scrollable. A fixed box that cannot fit everything scrolls now,
    // rather than silently losing the "everything" part.
    // In the layer (`asLayer`) the same element is a full-screen dialog: it is
    // the screen's height, its messages take whatever the header and the input
    // leave, and it still scrolls as a whole only when the hand-off form and
    // an open keyboard together leave no room.
    <div
      ref={layerRef}
      id={sheet ? panelId : undefined}
      className={panelClass}
      {...(asLayer
        ? {
            role: "dialog",
            "aria-modal": true,
            "aria-labelledby": layerTitleId,
            tabIndex: -1,
            style: visibleBox ? { height: visibleBox.height, top: visibleBox.top } : undefined,
          }
        : {})}
    >
          {asLayer && sheet ? (
            /* One row: who this is, the way to a person, start again, close.
               The panel's own header wrapped one word per line at 390px. */
            <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-border">
              <div className="min-w-0 flex-1 leading-tight">
                <h2 id={layerTitleId} className="font-heading text-[19px] font-medium whitespace-nowrap">
                  {sheet.layerTitle}
                </h2>
                <p className="text-[13px] text-muted-foreground whitespace-nowrap">{sheet.layerSubtitle}</p>
              </div>
              {handoffButton(true)}
              {resetButton}
              <button
                type="button"
                onClick={() => setLayerOpen(false)}
                aria-label="סגירת הצ׳אט"
                className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-md text-foreground hover:text-accent transition-colors duration-200"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
          ) : (
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
              {handoffButton(false)}
              {resetButton}
            </div>
          </div>
          )}

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
            /* No fixed floor here; the floor is what's inside. With the
             * hand-off form also open (open before consent is possible — see
             * the panel's own `overflow-y-auto`), flex-shrink once squeezed this
             * to literally zero and its content overflowed over the hand-off
             * form's. A fixed `min-h-[170px]` stopped that, on the belief that
             * 170px always held the checkbox and the start button. At 390px and
             * below it did not: the header wraps tall, this was squeezed to
             * 170, the checkbox row alone is 166 plus the notice's padding, and
             * the start button spilled under the message box's footer —
             * visible, but every tap landed on the footer.
             *
             * So the notice is taken out of the sizing: it fills an `absolute
             * inset-0` box and scrolls inside it, which contributes nothing to
             * this column's height except its own `min-h-24` — room for the
             * heading. The checkbox row is in flow and shrink-0, so this column
             * can never be shorter than heading-room plus the row, at any
             * width. When the panel cannot fit that, the panel scrolls.
             */
            <div className={asLayer ? "flex-1 min-h-0 flex flex-col" : "flex-1 flex flex-col"}>
              <div className="relative flex-1 min-h-24">
                <div data-chat-region="notice" className="absolute inset-0 overflow-y-auto px-6 pt-7 pb-5">
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
                      {consentPoints.map((point, i) => (
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
            <div
              ref={scrollRef}
              data-chat-region="messages"
              className={
                asLayer
                  ? "flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-5 space-y-3.5"
                  : "flex-1 overflow-y-auto px-6 py-6 space-y-3.5"
              }
            >
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
                            {/* A recommendation (blog-recommendation.ts) can
                                travel inside the message, and is machinery,
                                not conversation; so is a `lead` block
                                (interview-handoff.ts), which the function's
                                agents never write but a model could slip in.
                                Stripped here rather than on arrival so
                                `messages` stays exactly what the server sent;
                                stripping is a no-op for a reply without one. */}
                            <ReactMarkdown
                              urlTransform={allowTel}
                              components={{
                                a: ({ href, children }) => (
                                  <a
                                    href={chatHref(href)}
                                    className="text-accent underline underline-offset-4 hover:text-highlight transition-colors"
                                  >
                                    {children}
                                  </a>
                                ),
                              }}
                            >
                              {readRecommendation(readHandoff(m.content).visible).visible}
                            </ReactMarkdown>
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
                      // 16px in the layer: iOS zooms into any field smaller than that.
                      className={inputClass(asLayer ? "mt-1 min-h-11 px-3 py-2 text-base" : "mt-1 min-h-11 px-3 py-2 text-[15px]")}
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
                      className={inputClass(asLayer ? "mt-1 min-h-11 px-3 py-2 text-base text-right" : "mt-1 min-h-11 px-3 py-2 text-[15px] text-right")}
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

          <div
            className={
              asLayer
                ? "shrink-0 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] border-t border-border"
                : "px-5 py-4 border-t border-border"
            }
          >
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
        {sheet ? (
          /*
           * The phone's card: the question, one sentence, one button. The
           * explanation that stood here — a screen of it — is one tap away in
           * the <details>, word for word, and the chat is a layer of its own.
           */
          <div className="card-raised px-5 py-6">
            <h2 className="font-heading font-bold text-[26px] leading-[1.2]">
              {[line1, line2].filter(Boolean).map((l) => l!.trim()).join(" ")}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-foreground/75">{sheet.cardText}</p>
            <button
              ref={openerRef}
              type="button"
              onClick={() => {
                setLayerOpen(true);
                // The card is a way into the chat like the links to it: click_chat.
                leadEvents.chatOpened(chatMethod, descriptor.sectionId);
              }}
              aria-haspopup="dialog"
              aria-expanded={layerOpen}
              aria-controls={panelId}
              // The brief asked for a filled button; the system's CTA is "an
              // outline, never a fill" (primitives/Cta.tsx). The hero's answer
              // to the same tension is reused: a heavier border and a tint.
              className={ctaClass("mt-5 w-full")}
            >
              <MessageCircle size={18} aria-hidden="true" />
              {sheet.openLabel}
            </button>
            <details className="group mt-5 border-t border-border pt-1">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[15px] text-accent [&::-webkit-details-marker]:hidden">
                {sheet.detailsLabel}
                <ChevronDown size={18} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <div className="pb-2 pt-2">
                <p className="text-foreground/70 leading-relaxed">{descriptor.blurb}</p>
                <div className="mt-4 flex items-start gap-3 text-sm text-muted-foreground">
                  <Sparkles size={18} strokeWidth={1.5} className="text-highlight mt-0.5 shrink-0" />
                  <p className="leading-relaxed">{descriptor.note}</p>
                </div>
                {descriptor.tagline ? (
                  <p className="mt-4 border-r border-highlight pr-[14px] font-heading text-[19px] leading-[1.6]">
                    {descriptor.tagline}
                  </p>
                ) : null}
                {fence("mt-4 border-t border-border pt-4")}
              </div>
            </details>
          </div>
        ) : (
          <div className="lg:col-span-5 flex flex-col justify-center">
            <Eyebrow>
              {descriptor.eyebrow}
            </Eyebrow>
            <h2 className="font-heading font-bold text-[clamp(30px,3.4vw,42px)] mt-5 leading-[1.15]">
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
              <p className="mt-8 rounded-2xl border border-highlight/25 bg-highlight/10 px-6 py-5 font-heading font-semibold text-[19px] leading-[1.6] text-accent">
                {descriptor.tagline}
              </p>
            ) : null}

            {fence("mt-6 border-t border-border pt-[18px]")}
          </div>
        )}

        {panel}
      </div>
    </section>
  );
}

const FENCE_CARD = "rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm";
