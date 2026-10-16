import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, MessageCircle, Send } from "lucide-react";
import { services } from "@/services";
import { leadEvents } from "@/lib/analytics";
import { getAttribution } from "@/lib/attribution";
import { CONTACT } from "@/config/contact";
import { HUMAN_HANDOFF } from "@/config/compliance";
import { CtaButton } from "@/components/dorit/primitives/Cta";
import { Field, inputClass } from "@/components/dorit/primitives/Field";
import ContactChannels from "@/components/dorit/chat/ContactChannels";
import {
  ACKNOWLEDGEMENTS,
  CALL_TIME,
  CLEARINGHOUSE,
  CLEARINGHOUSE_REPORT,
  CLEARINGHOUSE_TEXT,
  CONCERN_LEGEND,
  CONCERNS,
  CONFIRMATION_FOLLOW_UP,
  GOAL,
  LIFE_STAGE,
  NOTES_HINT,
  TRANSPARENCY,
  UNKNOWN_LABEL,
  URGENCY,
  type Question,
} from "@/config/needs-wizard";
import {
  emptyState,
  isClaim,
  toInterviewSummary,
  valueOf,
  type Answer,
  type WizardState,
} from "@/lib/needs-wizard";
import { isIsraeliMobile, isIsraeliPhone } from "@/lib/phone";

/**
 * The needs interview as a short click-through (the brief of 2026-10-14): three
 * taps — what is on the visitor's mind, where they are in life, how soon — then
 * a name and a mobile, and the lead is saved and Dorit mailed. Then, optionally,
 * three more questions that fill in that same lead (`stage: "details"`, which
 * submit-lead matches to the lead it just saved). A backend that cannot fill a
 * lead in (`services.leads.updatesInterviews`) is never offered them. No list of
 * step names: a thin progress bar and "שאלה N מתוך 3".
 */

type StepId = "concern" | "life" | "urgency" | "contact" | "goal" | "clearinghouse" | "time";
type Segment = "main" | "extras";

/** The required part: three taps, then the contact step that saves the lead. */
const MAIN: readonly StepId[] = ["concern", "life", "urgency", "contact"];
/** The optional part, after the lead is saved. */
const EXTRAS: readonly StepId[] = ["goal", "clearinghouse", "time"];
const TAPS = 3;
const stepsOf = (segment: Segment) => (segment === "main" ? MAIN : EXTRAS);
/** `wizard_step`'s location: the step's place in the whole questionnaire, a number only. */
const globalStep = (segment: Segment, step: number) => (segment === "main" ? step : MAIN.length + step);

/** Long enough to see the chip chosen, short enough not to feel like a wait. */
const ADVANCE_DELAY_MS = 250;
type Phase = "steps" | "claim" | "saved" | "done" | "failed" | "detailsFailed";

const PHONE_ERROR = "מספר נייד צריך להתחיל ב-05 ולהכיל 10 ספרות";
const NAME_ERROR = "נא למלא שם.";
const EMAIL_ERROR = "כתובת המייל לא נראית תקינה.";

const CHIP =
  "inline-flex min-h-11 items-center rounded-md border border-border px-4 py-2 text-[16px] leading-snug text-foreground cursor-pointer " +
  "motion-safe:transition-colors hover:border-foreground/45 " +
  "peer-checked:border-highlight peer-checked:bg-highlight/10 " +
  "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-highlight";

const LINK =
  "text-[15px] text-accent underline decoration-highlight/50 underline-offset-4 hover:decoration-highlight min-h-11 inline-flex items-center";

/**
 * What a single-choice chip does on a phone, besides being chosen: a tap, Space
 * or Enter on it moves to the next step. An arrow key does not — in a radio
 * group the arrows move the selection *and* fire a click, and a keyboard user
 * walking the options must be able to pass one without leaving the screen.
 * Absent from md up, and on steps with more than one question or a text field.
 */
export interface PickHandlers {
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onKeyUp: () => void;
  onClick: () => void;
  onPointerDown: () => void;
}

/** A radio chip's handlers, split between the <input> and its <label>. */
const inputHandlers = (h?: PickHandlers) => (h ? { onKeyDown: h.onKeyDown, onKeyUp: h.onKeyUp, onClick: h.onClick } : {});
const labelHandlers = (h?: PickHandlers) => (h ? { onPointerDown: h.onPointerDown } : {});

/** One question as a real radio group or checkbox group, inside a fieldset with its legend. */
function Choices({
  question,
  value,
  onChange,
  withUnknown,
  pick,
  hideLegend,
}: {
  question: Question;
  value: Answer | undefined;
  onChange: (next: Answer | undefined) => void;
  withUnknown: boolean;
  pick?: PickHandlers;
  /** The step's heading already asks the question: the legend stays for assistive tech only. */
  hideLegend?: boolean;
}) {
  const options = withUnknown && !question.options.includes(UNKNOWN_LABEL)
    ? [...question.options, UNKNOWN_LABEL]
    : [...question.options];
  const chosen = value === undefined ? [] : typeof value === "string" ? [value] : [...value];

  const toggle = (option: string) => {
    if (!question.multi) return onChange(option);
    // "לא יודע/ת" stands alone: it is an answer about the whole question.
    if (option === UNKNOWN_LABEL) return onChange(chosen.includes(UNKNOWN_LABEL) ? undefined : [UNKNOWN_LABEL]);
    const rest = chosen.filter((c) => c !== UNKNOWN_LABEL);
    const next = rest.includes(option) ? rest.filter((c) => c !== option) : [...rest, option];
    onChange(next.length ? next : undefined);
  };

  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0 m-0 min-w-0">
      <legend className={hideLegend ? "sr-only" : "font-heading text-[19px] md:text-[21px] mb-1"}>{question.legend}</legend>
      <div className="flex flex-wrap gap-2.5">
        {options.map((option) => (
          <label key={option} {...labelHandlers(question.multi ? undefined : pick)}>
            <input
              type={question.multi ? "checkbox" : "radio"}
              name={`nw-${question.key}`}
              value={option}
              checked={chosen.includes(option)}
              onChange={() => toggle(option)}
              {...inputHandlers(question.multi ? undefined : pick)}
              className="peer sr-only"
            />
            <span className={CHIP}>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function NeedsWizard() {
  const [state, setState] = useState<WizardState>(emptyState);
  const [segment, setSegment] = useState<Segment>("main");
  const [step, setStep] = useState<number>(1);
  const [phase, setPhase] = useState<Phase>("steps");
  const [ack, setAck] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [offerDeclined, setOfferDeclined] = useState<boolean>(false);
  const [claim, setClaim] = useState<{ name: string; phone: string; error: string; sending: boolean; result: string }>({
    name: "",
    phone: "",
    error: "",
    sending: false,
    result: "",
  });
  const started = useRef<boolean>(false);
  // One run of the questionnaire: its details find the lead its contact step saved by this.
  const runRef = useRef<string>(`wizard:${crypto.randomUUID()}`);
  const ackIndex = useRef<number>(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef<boolean>(false);

  // Focus follows the step — but only once the visitor has moved: on page
  // load the questionnaire must not pull the page down to itself. And the step
  // comes to the top of the screen (under the fixed header — scroll-mt-32), so
  // on a phone its answers and its button sit above the bottom bar without a
  // scroll (the brief of 2026-10-14); focus alone left a step where the last
  // one ended, the button under the bar.
  useEffect(() => {
    const h = headingRef.current;
    if (!moved.current || !h) return;
    h.focus({ preventScroll: true });
    const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    h.scrollIntoView?.({ block: "start", behavior: still ? "auto" : "smooth" });
  }, [step, phase, segment]);

  const steps = stepsOf(segment);
  const id: StepId = steps[step - 1];

  const begin = () => {
    if (started.current) return;
    started.current = true;
    leadEvents.wizardStarted();
  };

  const setAnswer = (key: string, value: Answer | undefined) => {
    begin();
    setState((s) => {
      const answers = { ...s.answers };
      if (value === undefined) delete answers[key];
      else answers[key] = value;
      return { ...s, answers };
    });
  };

  const patch = (next: Partial<WizardState>) => {
    begin();
    setState((s) => ({ ...s, ...next }));
  };

  /** The one tap question a step asks, if it asks one. */
  const questionOf = (s: StepId): Question | null =>
    s === "life" ? LIFE_STAGE : s === "urgency" ? URGENCY : s === "goal" ? GOAL : s === "clearinghouse" ? CLEARINGHOUSE_REPORT : s === "time" ? CALL_TIME : null;

  const acknowledgementFor = (s: StepId): string => {
    if (s === "concern") return state.concern ? nextAnswered() : "";
    const q = questionOf(s);
    if (!q) return "";
    const a = state.answers[q.key];
    if (a === UNKNOWN_LABEL) return ACKNOWLEDGEMENTS.unknown;
    return valueOf(q, a, state) ? nextAnswered() : "";
  };

  function nextAnswered(): string {
    const line = ACKNOWLEDGEMENTS.answered[ackIndex.current % ACKNOWLEDGEMENTS.answered.length];
    ackIndex.current += 1;
    return line;
  }

  const goTo = (n: number) => {
    moved.current = true;
    setErrors({});
    setStep(n);
  };

  const summaryFor = (stage: "complete" | "details") => {
    const attribution = getAttribution();
    return {
      ...toInterviewSummary(state, new Date()),
      stage,
      conversationRef: runRef.current,
      channel: attribution?.channel,
      campaign: attribution?.campaign ?? undefined,
      landingPath: window.location.pathname,
    };
  };

  const urgency = (): string | undefined => {
    const a = state.answers[URGENCY.key];
    return typeof a === "string" ? a : undefined;
  };

  /** The contact step: the lead is saved here, and Dorit mailed. */
  const saveLead = async () => {
    setSubmitting(true);
    try {
      const receipt = await services.leads.submitInterview(summaryFor("complete"));
      if (!receipt?.ok) throw new Error(`rejected${receipt?.rid ? ` rid=${receipt.rid}` : ""}`);
      leadEvents.wizardStep(globalStep("main", MAIN.length));
      leadEvents.wizardCompleted(state.concern, urgency());
      moved.current = true;
      setAck("");
      setPhase("saved");
    } catch (e) {
      // The answers stay where they are: a retry must not cost the visitor what
      // they already typed.
      console.warn("[wizard] submitInterview failed — showing direct channels", String(e));
      moved.current = true;
      setPhase("failed");
    } finally {
      setSubmitting(false);
    }
  };

  /** How many of the three optional questions were answered. */
  const followupAnswered = () =>
    [GOAL, CLEARINGHOUSE_REPORT, CALL_TIME].filter((q) => state.answers[q.key] !== undefined).length;

  /** The optional questions, filling in the lead saved a moment ago. */
  const saveDetails = async () => {
    setSubmitting(true);
    try {
      const receipt = await services.leads.submitInterview(summaryFor("details"));
      if (!receipt?.ok) throw new Error(`rejected${receipt?.rid ? ` rid=${receipt.rid}` : ""}`);
      // The last step's wizard_step went out from `forward`.
      leadEvents.wizardFollowupCompleted(followupAnswered());
      moved.current = true;
      setPhase("done");
    } catch (e) {
      console.warn("[wizard] details failed — the lead itself is saved", String(e));
      moved.current = true;
      setPhase("detailsFailed");
    } finally {
      setSubmitting(false);
    }
  };

  const forward = () => {
    begin();
    if (id === "concern" && isClaim(state.concern)) {
      moved.current = true;
      setAck("");
      setPhase("claim");
      return;
    }
    if (id === "contact") {
      const found: Record<string, string> = {};
      if (!state.name.trim()) found.name = NAME_ERROR;
      if (!isIsraeliMobile(state.phone)) found.phone = PHONE_ERROR;
      setErrors(found);
      if (found.name) leadEvents.formError("name");
      if (found.phone) leadEvents.formError("phone");
      if (Object.keys(found).length) return;
      void saveLead();
      return;
    }
    if (id === "clearinghouse" && state.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email.trim())) {
      setErrors({ email: EMAIL_ERROR });
      return;
    }
    leadEvents.wizardStep(globalStep(segment, step));
    if (segment === "extras" && step === EXTRAS.length) {
      void saveDetails();
      return;
    }
    setAck(acknowledgementFor(id));
    goTo(step + 1);
  };

  /** "דילוג על השאלה": on, with the skip reported by the question's number. */
  const skip = () => {
    begin();
    leadEvents.wizardSkipped(globalStep(segment, step));
    if (id === "concern") patch({ concern: undefined });
    else {
      const q = questionOf(id);
      if (q) setAnswer(q.key, undefined);
    }
    setAck("");
    if (segment === "extras" && step === EXTRAS.length) {
      void saveDetails();
      return;
    }
    goTo(step + 1);
  };

  const back = () => {
    setAck("");
    goTo(Math.max(1, step - 1));
  };

  /** One tap moves on: the three required questions and the goal. */
  const advancesOnPick = (s: StepId): boolean => s === "concern" || s === "life" || s === "urgency" || s === "goal";

  // The advance runs a beat after the tap, through `forward` — so the chosen
  // chip is seen chosen, the answer is in state when the claim check reads it,
  // and `wizard_step` fires exactly as it does for "המשך". It is dropped if the
  // visitor has left the step meanwhile.
  const latest = useRef({ forward, step, phase, segment });
  latest.current = { forward, step, phase, segment };
  const arrowing = useRef<boolean>(false);
  const advanceTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(advanceTimer.current), []);
  const scheduleAdvance = () => {
    const from = { step, segment };
    window.clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(() => {
      const now = latest.current;
      if (now.step === from.step && now.segment === from.segment && now.phase === "steps") now.forward();
    }, ADVANCE_DELAY_MS);
  };
  const pick: PickHandlers | undefined = advancesOnPick(id)
    ? {
        onKeyDown: (e) => {
          if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") arrowing.current = true;
          else if (e.key === "Enter") {
            // Enter does nothing on a radio natively; here it chooses and moves on.
            e.preventDefault();
            e.currentTarget.click();
          }
        },
        onKeyUp: () => {
          arrowing.current = false;
        },
        onClick: () => {
          if (arrowing.current) return;
          scheduleAdvance();
        },
        onPointerDown: () => {
          arrowing.current = false;
        },
      }
    : undefined;

  const sendClaim = async () => {
    if (!isIsraeliPhone(claim.phone)) {
      setClaim((c) => ({ ...c, error: "נא להזין מספר טלפון ישראלי — מתחיל ב-0, 9–10 ספרות." }));
      return;
    }
    setClaim((c) => ({ ...c, error: "", sending: true }));
    try {
      const attribution = getAttribution();
      const receipt = await services.support.escalate({
        reason: "claim_or_policy",
        summary: "פנייה משאלון ההיכרות באתר: תביעה או בעיה בפוליסה קיימת. המבקר ביקש שדורית תחזור אליו.",
        agent: "needs_wizard",
        name: claim.name.trim(),
        phone: claim.phone.trim(),
        channel: attribution?.channel,
        campaign: attribution?.campaign ?? undefined,
        landingPath: window.location.pathname,
      });
      if (receipt.ok) leadEvents.wizardClaimHandoff();
      setClaim((c) => ({ ...c, sending: false, result: receipt.ok ? HUMAN_HANDOFF.confirmation : HUMAN_HANDOFF.failure }));
    } catch {
      setClaim((c) => ({ ...c, sending: false, result: HUMAN_HANDOFF.failure }));
    }
  };

  const heading = (text: string) => (
    <h3
      ref={headingRef}
      tabIndex={-1}
      // scroll-mt: focusing the new step's heading scrolls it into view, and the
      // site header is fixed — without the margin it lands underneath it.
      className="font-heading text-[24px] md:text-[28px] leading-snug outline-none scroll-mt-32"
    >
      {text}
    </h3>
  );

  /** Back as a quiet link, and the way on. In RTL forward points left, back points right. */
  const navigation = (next: React.ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      {step > 1 ? (
        <button type="button" onClick={back} className={LINK}>
          <ArrowRight size={16} aria-hidden="true" className="me-1.5" />
          הקודם
        </button>
      ) : (
        <span />
      )}
      {next}
    </div>
  );

  /** A tap question's way on: skip it, or — once answered — go on with that answer. */
  const tapOn = () => (
    <button type="button" onClick={answeredHere() ? forward : skip} className={LINK}>
      {answeredHere() ? "המשך" : "דילוג על השאלה"}
      <ArrowLeft size={16} aria-hidden="true" className="ms-1.5" />
    </button>
  );

  function answeredHere(): boolean {
    if (id === "concern") return Boolean(state.concern);
    const q = questionOf(id);
    return q ? state.answers[q.key] !== undefined : false;
  }

  if (phase === "claim") {
    return (
      <div className="flex flex-col gap-5">
        {heading("תביעה או בעיה בפוליסה — עדיף לדבר עם דורית ישירות")}
        <p className="m-0 text-[17px] leading-relaxed text-foreground/80">
          זה לא נושא לשאלון. אפשר לפנות אליה עכשיו באחת הדרכים האלה:
        </p>
        <ContactChannels contact={CONTACT} />
        {claim.result ? (
          <p role="status" className="m-0 text-[17px]">{claim.result}</p>
        ) : (
          <form
            aria-label="בקשה שדורית תחזור אליך"
            className="flex flex-col gap-4 border-t border-border pt-5"
            onSubmit={(e) => {
              e.preventDefault();
              void sendClaim();
            }}
          >
            <p className="m-0 text-[16px] text-foreground/80">או שדורית תחזור אליך (לבחירתך):</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="שם">
                <input
                  className={inputClass()}
                  value={claim.name}
                  onChange={(e) => setClaim((c) => ({ ...c, name: e.target.value }))}
                  placeholder={HUMAN_HANDOFF.namePlaceholder}
                  autoComplete="name"
                />
              </Field>
              <Field label="טלפון">
                <input
                  className={inputClass()}
                  value={claim.phone}
                  onChange={(e) => setClaim((c) => ({ ...c, phone: e.target.value }))}
                  placeholder={HUMAN_HANDOFF.phonePlaceholder}
                  inputMode="tel"
                  autoComplete="tel"
                  dir="ltr"
                  aria-invalid={claim.error ? true : undefined}
                />
              </Field>
            </div>
            {claim.error ? <p role="alert" className="m-0 text-destructive text-[15px]">{claim.error}</p> : null}
            <CtaButton type="submit" disabled={claim.sending} className="self-start">
              {claim.sending ? <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              שדורית תחזור אליי
            </CtaButton>
          </form>
        )}
        <div>
          <button
            type="button"
            className={LINK}
            onClick={() => {
              moved.current = true;
              setPhase("steps");
              setSegment("main");
              setStep(1);
            }}
          >
            <ArrowRight size={16} aria-hidden="true" className="me-1.5" />
            הקודם
          </button>
        </div>
      </div>
    );
  }

  const firstName = state.name.trim().split(/\s+/)[0] ?? "";

  if (phase === "saved") {
    return (
      <div className="flex flex-col gap-4">
        <div role="status" className="flex flex-col gap-3">
          {heading(`תודה${firstName ? ` ${firstName}` : ""}! דורית תחזור אליך בקרוב.`)}
          <p className="m-0 text-[15px] leading-relaxed text-muted-foreground">{TRANSPARENCY}</p>
        </div>
        {services.leads.updatesInterviews && !offerDeclined ? (
          <div className="flex flex-col gap-3 border-t border-border pt-5">
            <p className="m-0 text-[17px]">רוצים לעזור לדורית להתכונן? עוד 3 שאלות (לא חובה)</p>
            <div className="flex flex-wrap items-center gap-4">
              <CtaButton
                onClick={() => {
                  leadEvents.wizardFollowupStarted();
                  moved.current = true;
                  setSegment("extras");
                  setStep(1);
                  setPhase("steps");
                }}
              >
                בטח
                <ArrowLeft size={18} aria-hidden="true" />
              </CtaButton>
              <button type="button" className={LINK} onClick={() => setOfferDeclined(true)}>
                לא עכשיו
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="flex flex-col gap-3" role="status">
        {heading("מעולה, דורית תגיע מוכנה.")}
        <p className="m-0 text-[17px] leading-relaxed">{CONFIRMATION_FOLLOW_UP}</p>
      </div>
    );
  }

  if (phase === "detailsFailed") {
    return (
      <div className="flex flex-col gap-4">
        {heading("התשובות הנוספות לא נשמרו")}
        <p className="m-0 text-[17px] leading-relaxed">
          הפרטים שלך כבר אצל דורית, והיא תחזור אליך. את התשובות האלה אפשר לספר לה בשיחה.
        </p>
        <div>
          <CtaButton muted onClick={() => void saveDetails()} disabled={submitting}>
            ניסיון נוסף
          </CtaButton>
        </div>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="flex flex-col gap-4">
        {heading("השליחה לא הצליחה")}
        <p className="m-0 text-[17px]">{HUMAN_HANDOFF.failure}</p>
        <ContactChannels contact={CONTACT} />
        <div>
          <CtaButton
            muted
            onClick={() => {
              moved.current = true;
              setPhase("steps");
              setSegment("main");
              setStep(MAIN.length);
            }}
          >
            חזרה לניסיון נוסף
          </CtaButton>
        </div>
      </div>
    );
  }

  const isContact = id === "contact";
  const counted = segment === "main" ? TAPS : EXTRAS.length;
  const progress = Math.round((Math.min(step, counted) / counted) * 100);
  const fieldError = (key: string) =>
    errors[key] ? (
      <p id={`nw-${key}-error`} role="alert" className="m-0 mt-1.5 text-destructive text-[15px]">
        {errors[key]}
      </p>
    ) : null;
  const whatsappText = [
    "שלום דורית, מילאתי את השאלון באתר.",
    state.concern ? `מה מעסיק אותי: ${state.concern}.` : "",
    typeof state.answers[LIFE_STAGE.key] === "string" ? `שלב חיים: ${state.answers[LIFE_STAGE.key]}.` : "",
    urgency() ? `דחיפות: ${urgency()}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        {segment === "main" && !isContact ? (
          <p className="m-0 text-[15px] text-accent">3 שאלות קצרות — פחות מדקה</p>
        ) : null}
        <p className="m-0 text-[14px] text-muted-foreground">
          {isContact ? "כמעט סיימנו" : `שאלה ${step} מתוך ${counted}${segment === "extras" ? " · לא חובה" : ""}`}
        </p>
        <div
          role="progressbar"
          aria-label="התקדמות בשאלון"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={isContact ? 100 : progress}
          className="h-1 w-full rounded-full bg-border overflow-hidden"
        >
          <div
            className="h-full bg-highlight motion-safe:transition-[width] motion-safe:duration-200"
            style={{ width: `${isContact ? 100 : progress}%` }}
          />
        </div>
      </div>

      <p aria-live="polite" className="m-0 min-h-6 text-[16px] text-accent">
        {ack}
      </p>

      {id === "concern" ? (
        <div className="flex flex-col gap-4">
          {heading(CONCERN_LEGEND)}
          <fieldset className="flex flex-col gap-3 border-0 p-0 m-0 min-w-0">
            <legend className="sr-only">{CONCERN_LEGEND}</legend>
            <div className="flex flex-wrap gap-2.5">
              {CONCERNS.map((c) => (
                <label key={c.label} {...labelHandlers(pick)}>
                  <input
                    type="radio"
                    name="nw-concern"
                    value={c.label}
                    checked={state.concern === c.label}
                    onChange={() => patch({ concern: c.label })}
                    {...inputHandlers(pick)}
                    className="peer sr-only"
                  />
                  <span className={CHIP}>{c.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {navigation(tapOn())}
        </div>
      ) : null}

      {id === "life" || id === "urgency" ? (
        <div className="flex flex-col gap-4">
          {heading(questionOf(id)!.legend)}
          <Choices question={questionOf(id)!} hideLegend value={state.answers[questionOf(id)!.key]} onChange={(v) => setAnswer(questionOf(id)!.key, v)} withUnknown={false} pick={pick} />
          {navigation(tapOn())}
        </div>
      ) : null}

      {isContact ? (
        <form
          aria-label="פרטי קשר"
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            forward();
          }}
        >
          {heading("איך דורית תחזור אליך?")}
          <p className="m-0 text-[15px]" data-track-location="wizard_step4">
            מעדיפים וואטסאפ?{" "}
            <a
              href={`https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(whatsappText)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent underline decoration-highlight/50 underline-offset-4"
            >
              <MessageCircle size={16} aria-hidden="true" />
              כתבו לדורית
            </a>
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Field label="שם">
                <input
                  className={inputClass()}
                  value={state.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  autoComplete="name"
                  required
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby={errors.name ? "nw-name-error" : undefined}
                />
              </Field>
              {fieldError("name")}
            </div>
            <div>
              <Field label="טלפון נייד">
                <input
                  type="tel"
                  className={inputClass()}
                  value={state.phone}
                  onChange={(e) => patch({ phone: e.target.value })}
                  placeholder="05X-XXXXXXX"
                  inputMode="tel"
                  autoComplete="tel"
                  dir="ltr"
                  required
                  aria-invalid={errors.phone ? true : undefined}
                  aria-describedby={errors.phone ? "nw-phone-error" : undefined}
                />
              </Field>
              {fieldError("phone")}
            </div>
          </div>
          <p className="m-0 text-[14px] leading-relaxed text-muted-foreground">{TRANSPARENCY}</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={back} className={LINK}>
              <ArrowRight size={16} aria-hidden="true" className="me-1.5" />
              הקודם
            </button>
            <div className="flex flex-col items-end gap-1">
              <CtaButton type="submit" disabled={submitting}>
                שליחה לדורית
                {submitting ? <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
              </CtaButton>
              <p className="m-0 text-[14px] text-muted-foreground">דורית חוזרת תוך יום עסקים</p>
            </div>
          </div>
        </form>
      ) : null}

      {id === "goal" ? (
        <div className="flex flex-col gap-4">
          {heading(GOAL.legend)}
          <Choices question={GOAL} hideLegend value={state.answers[GOAL.key]} onChange={(v) => setAnswer(GOAL.key, v)} withUnknown={false} pick={pick} />
          {navigation(tapOn())}
        </div>
      ) : null}

      {id === "clearinghouse" ? (
        <div className="flex flex-col gap-4">
          {heading(CLEARINGHOUSE_REPORT.legend)}
          <Choices
            question={CLEARINGHOUSE_REPORT}
            hideLegend
            value={state.answers[CLEARINGHOUSE_REPORT.key]}
            onChange={(v) => setAnswer(CLEARINGHOUSE_REPORT.key, v)}
            withUnknown={false}
          />
          {/* No report yet: the offer to pull one (the user's choice of
              2026-10-14 — the questionnaire stays the clearinghouse's way in). */}
          {state.answers[CLEARINGHOUSE_REPORT.key] !== undefined && state.answers[CLEARINGHOUSE_REPORT.key] !== CLEARINGHOUSE_REPORT.options[0] ? (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <p className="m-0 text-[16px] leading-relaxed text-foreground/80">{CLEARINGHOUSE_TEXT}</p>
              <Choices
                question={{ ...CLEARINGHOUSE, legend: "רוצים שדורית תשלוף לכם את הנתונים?" }}
                value={state.answers[CLEARINGHOUSE.key]}
                onChange={(v) => setAnswer(CLEARINGHOUSE.key, v)}
                withUnknown={false}
              />
              {state.answers[CLEARINGHOUSE.key] === CLEARINGHOUSE.options[0] ? (
                <div>
                  <Field label="אימייל לשליחת הקישור — לבחירתך" className="max-w-[420px]">
                    <input
                      type="email"
                      className={inputClass()}
                      value={state.email}
                      onChange={(e) => patch({ email: e.target.value })}
                      autoComplete="email"
                      dir="ltr"
                      aria-invalid={errors.email ? true : undefined}
                      aria-describedby={errors.email ? "nw-email-error" : undefined}
                    />
                  </Field>
                  {fieldError("email")}
                </div>
              ) : null}
            </div>
          ) : null}
          {navigation(
            <CtaButton type="button" onClick={forward}>
              המשך
              <ArrowLeft size={18} aria-hidden="true" />
            </CtaButton>,
          )}
        </div>
      ) : null}

      {id === "time" ? (
        <div className="flex flex-col gap-4">
          {heading(CALL_TIME.legend)}
          <Choices question={CALL_TIME} hideLegend value={state.answers[CALL_TIME.key]} onChange={(v) => setAnswer(CALL_TIME.key, v)} withUnknown={false} />
          <Field label="משהו נוסף שכדאי שדורית תדע? (לא חובה)">
            <textarea
              className={inputClass("min-h-20 resize-y")}
              value={state.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              maxLength={600}
              aria-describedby="nw-notes-hint"
            />
          </Field>
          <p id="nw-notes-hint" className="-mt-3 m-0 text-[14px] text-muted-foreground">
            {NOTES_HINT}
          </p>
          {navigation(
            <CtaButton type="button" onClick={forward} disabled={submitting}>
              שמירת התשובות
              {submitting ? <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden="true" /> : <ArrowLeft size={18} aria-hidden="true" />}
            </CtaButton>,
          )}
        </div>
      ) : null}
    </div>
  );
}
