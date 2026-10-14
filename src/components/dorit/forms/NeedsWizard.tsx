import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  Compass,
  FileSearch,
  Loader2,
  Phone,
  Send,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
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
  CLEARINGHOUSE,
  CLEARINGHOUSE_TEXT,
  CONCERN_LEGEND,
  CONCERNS,
  CONFIRMATION_FOLLOW_UP,
  CONTACT_INTRO,
  DAY_LABELS,
  GOAL,
  LIFE_STAGE,
  SLOTS,
  TIME_NOTE,
  TRANSPARENCY,
  UNKNOWN_LABEL,
  type DayChoice,
  type Question,
  type SlotKey,
} from "@/config/needs-wizard";
import {
  emptyState,
  isClaim,
  meetingTopicOf,
  timingOf,
  toInterviewSummary,
  valueOf,
  type Answer,
  type WizardState,
} from "@/lib/needs-wizard";
import { dayChoices, isWorkingDay } from "@/lib/wall-clock";
import { isIsraeliMobile, isIsraeliPhone } from "@/lib/phone";
import { MD_UP, useMediaQuery } from "@/hooks/useMediaQuery";

/**
 * The needs interview, short first (the lead-generation brief of 2026-10-14).
 *
 * Two required steps — what is on the visitor's mind, then a name and a phone —
 * and the lead is saved and Dorit mailed. Then, optionally, four more questions
 * that fill in that same lead (`stage: "details"`, which submit-lead matches to
 * the lead it just saved) so she arrives prepared. A backend that cannot fill a
 * lead in (`services.leads.updatesInterviews`) is never offered them. The chat
 * stays one link away for anyone who would rather write. See
 * `config/needs-wizard.ts`.
 */

type StepId = "concern" | "contact" | "life" | "goal" | "clearinghouse" | "time";
type Stage = { id: StepId; label: string; icon: LucideIcon };

/** The required part: the lead is saved when its last step is sent. */
const MAIN: readonly Stage[] = [
  { id: "concern", label: "מה מעסיק", icon: Compass },
  { id: "contact", label: "פרטי קשר", icon: Phone },
];
/** The optional part, after the lead is saved. */
const EXTRAS: readonly Stage[] = [
  { id: "life", label: "שלב חיים", icon: Users },
  { id: "goal", label: "יעד", icon: Target },
  { id: "clearinghouse", label: "מסלקה", icon: FileSearch },
  { id: "time", label: "מועד", icon: CalendarClock },
];
type Segment = "main" | "extras";
const stagesOf = (segment: Segment) => (segment === "main" ? MAIN : EXTRAS);
/** `wizard_step`'s location: the step's place in the whole questionnaire, a number only. */
const globalStep = (segment: Segment, step: number) => (segment === "main" ? step : MAIN.length + step);

/** Long enough to see the chip chosen, short enough not to feel like a wait. */
const ADVANCE_DELAY_MS = 250;
type Phase = "steps" | "claim" | "saved" | "done" | "failed" | "detailsFailed";

const PHONE_ERROR = "נא להזין מספר נייד ישראלי — למשל 050-1234567.";
const NAME_ERROR = "נא למלא שם.";
const EMAIL_ERROR = "כתובת המייל לא נראית תקינה.";
const EXTRAS_OFFER = "רוצים לעזור לדורית להתכונן? עוד 4 שאלות קצרות";

const CHIP =
  "inline-flex min-h-11 items-center rounded-md border border-border px-4 py-2 text-[16px] leading-snug text-foreground cursor-pointer " +
  "motion-safe:transition-colors hover:border-foreground/45 " +
  "peer-checked:border-highlight peer-checked:bg-highlight/10 " +
  "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-highlight";

const LINK =
  "text-[15px] text-accent underline decoration-highlight/50 underline-offset-4 hover:decoration-highlight min-h-11 inline-flex items-center";

/**
 * Where the visitor is. Done stages carry a check and lead back to themselves;
 * the current one is marked for assistive tech with aria-current; the rest wait.
 * Labels show beside the icons from the tablet width up; on a phone the
 * labels stay for screen readers.
 */
function Stepper({ stages, step, onJump }: { stages: readonly Stage[]; step: number; onJump: (n: number) => void }) {
  return (
    <ol
      aria-label="שלבי השאלון"
      className={`m-0 p-0 list-none grid gap-1 md:gap-2 ${stages.length === 2 ? "grid-cols-2 max-w-[260px]" : "grid-cols-4 max-w-[520px]"}`}
    >
      {stages.map(({ label, icon: Icon }, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        const circle =
          "mx-auto flex h-8 w-8 md:h-10 md:w-10 items-center justify-center rounded-full border motion-safe:transition-colors " +
          (current
            ? "border-highlight bg-highlight/15 text-accent"
            : done
              ? "border-highlight text-accent hover:bg-highlight/10"
              : "border-border text-muted-foreground");
        const content = (
          <>
            <span className={circle}>
              {done ? <Check className="h-4 w-4 md:h-[18px] md:w-[18px]" aria-hidden="true" /> : <Icon className="h-4 w-4 md:h-[18px] md:w-[18px]" aria-hidden="true" />}
            </span>
            <span className={`mt-1.5 hidden md:block text-[13px] leading-tight ${current ? "text-foreground" : "text-muted-foreground"}`}>
              {label}
            </span>
          </>
        );
        return (
          <li key={label} className="text-center" aria-current={current ? "step" : undefined}>
            {done ? (
              <button
                type="button"
                onClick={() => onJump(n)}
                className="w-full min-h-11 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight"
                aria-label={`חזרה לשלב ${n}: ${label}`}
              >
                {content}
              </button>
            ) : (
              <div className="min-h-11">
                {content}
                <span className="sr-only md:hidden">{`שלב ${n}: ${label}`}</span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

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
}: {
  question: Question;
  value: Answer | undefined;
  onChange: (next: Answer | undefined) => void;
  withUnknown: boolean;
  pick?: PickHandlers;
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
      <legend className="font-heading text-[19px] md:text-[21px] mb-1">{question.legend}</legend>
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
  const [claim, setClaim] = useState<{ name: string; phone: string; error: string; sending: boolean; result: string }>({
    name: "",
    phone: "",
    error: "",
    sending: false,
    result: "",
  });
  // Below md a single-choice step moves on when an answer is tapped. From md up
  // nothing changes: every step waits for "המשך".
  const isDesktop = useMediaQuery(MD_UP, true);
  const started = useRef<boolean>(false);
  const ackIndex = useRef<number>(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef<boolean>(false);

  // Focus follows the step — but only once the visitor has moved: on page
  // load the wizard must not pull the page down to itself.
  useEffect(() => {
    if (moved.current) headingRef.current?.focus();
  }, [step, phase, segment]);

  const stages = stagesOf(segment);
  const id: StepId = stages[step - 1].id;
  const days = dayChoices(new Date());

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

  /** The one question a step asks, for the acknowledgement it earns and the auto-advance. */
  const questionOf = (s: StepId): Question | null =>
    s === "life" ? LIFE_STAGE : s === "goal" ? GOAL : s === "clearinghouse" ? CLEARINGHOUSE : null;

  const acknowledgementFor = (s: StepId): string => {
    if (s === "concern") return state.concern ? nextAnswered() : ACKNOWLEDGEMENTS.skipped;
    const q = questionOf(s);
    if (!q) return "";
    const a = state.answers[q.key];
    if (a === UNKNOWN_LABEL) return ACKNOWLEDGEMENTS.unknown;
    return valueOf(q, a, state) ? nextAnswered() : ACKNOWLEDGEMENTS.skipped;
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

  /** What submit-lead receives: everything answered so far, and where the visitor came from. */
  const summaryFor = (stage: "complete" | "details") => {
    const attribution = getAttribution();
    return {
      ...toInterviewSummary(state, new Date()),
      stage,
      channel: attribution?.channel,
      campaign: attribution?.campaign ?? undefined,
      landingPath: window.location.pathname,
    };
  };

  /** The second step: the lead is saved here, and Dorit mailed. */
  const saveLead = async () => {
    setSubmitting(true);
    try {
      const receipt = await services.leads.submitInterview(summaryFor("complete"));
      if (!receipt?.ok) throw new Error(`rejected${receipt?.rid ? ` rid=${receipt.rid}` : ""}`);
      leadEvents.wizardStep(globalStep("main", MAIN.length));
      leadEvents.wizardCompleted();
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

  /** The optional questions, filling in the lead saved a moment ago. */
  const saveDetails = async () => {
    setSubmitting(true);
    try {
      const receipt = await services.leads.submitInterview(summaryFor("details"));
      if (!receipt?.ok) throw new Error(`rejected${receipt?.rid ? ` rid=${receipt.rid}` : ""}`);
      // The last step's wizard_step went out from `forward`.
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

  const contactErrors = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (!state.name.trim()) found.name = NAME_ERROR;
    if (!isIsraeliMobile(state.phone)) found.phone = PHONE_ERROR;
    return found;
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
      const found = contactErrors();
      setErrors(found);
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

  const back = () => {
    setAck("");
    goTo(Math.max(1, step - 1));
  };

  /**
   * Steps that are one single-choice question — the concern, life stage, the
   * goal. The clearinghouse step may open an email field, and the meeting step
   * asks two things, so they keep "המשך".
   */
  const advancesOnPick = (s: StepId): boolean => !isDesktop && (s === "concern" || s === "life" || s === "goal");

  // The advance runs a beat after the tap, through `forward` — so the chosen
  // chip is seen chosen, the answer is in state when the acknowledgement and
  // the claim check read it, and `wizard_step` fires exactly as it does for
  // "המשך". It is dropped if the visitor has left the step meanwhile.
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

  /** Back and forward as real buttons. In RTL forward points left, back points right. */
  const navigation = (next: React.ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
      {step > 1 ? (
        <CtaButton muted onClick={back}>
          <ArrowRight size={18} aria-hidden="true" />
          הקודם
        </CtaButton>
      ) : (
        <span />
      )}
      {next}
    </div>
  );

  const continueButton = (label = "המשך") =>
    pick ? (
      // A tap on an answer already moves on, so this is the way past the
      // question without one — or onward with the answer given earlier.
      <button type="button" onClick={forward} className={LINK}>
        {answeredHere() ? "המשך" : "דילוג על השאלה"}
        <ArrowLeft size={16} aria-hidden="true" className="ms-1.5" />
      </button>
    ) : (
      <CtaButton type="button" onClick={forward} disabled={submitting}>
        {label}
        {submitting ? <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden="true" /> : <ArrowLeft size={18} aria-hidden="true" />}
      </CtaButton>
    );

  /** Whether the current single-choice step already holds an answer. */
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
          <CtaButton
            muted
            onClick={() => {
              moved.current = true;
              setPhase("steps");
              setSegment("main");
              setStep(1);
            }}
          >
            <ArrowRight size={18} aria-hidden="true" />
            הקודם
          </CtaButton>
        </div>
      </div>
    );
  }

  if (phase === "saved") {
    return (
      <div className="flex flex-col gap-4">
        <div role="status" className="flex flex-col gap-4">
          {heading("נשמר — תודה")}
          <p className="m-0 text-[17px] leading-relaxed">הפרטים נשלחו לדורית. נושא הפגישה: {meetingTopicOf(state)}.</p>
          <p className="m-0 text-[17px] leading-relaxed">{CONFIRMATION_FOLLOW_UP}</p>
          <p className="m-0 text-[15px] leading-relaxed text-muted-foreground">{TRANSPARENCY}</p>
        </div>
        {services.leads.updatesInterviews ? (
          <div className="border-t border-border pt-5">
            <CtaButton
              onClick={() => {
                moved.current = true;
                setSegment("extras");
                setStep(1);
                setPhase("steps");
              }}
            >
              {EXTRAS_OFFER}
              <ArrowLeft size={18} aria-hidden="true" />
            </CtaButton>
          </div>
        ) : null}
      </div>
    );
  }

  if (phase === "done") {
    const timing = timingOf(state);
    return (
      <div className="flex flex-col gap-4" role="status">
        {heading("תודה — דורית תגיע מוכנה")}
        <p className="m-0 text-[17px] leading-relaxed">
          התשובות נוספו לפנייה שלך. נושא הפגישה: {meetingTopicOf(state)}
          {timing ? `. מועד מבוקש: ${timing}` : ""}.
        </p>
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

  const progress = Math.round((step / stages.length) * 100);
  const fieldError = (key: string) =>
    errors[key] ? (
      <p id={`nw-${key}-error`} role="alert" className="m-0 mt-1.5 text-destructive text-[15px]">
        {errors[key]}
      </p>
    ) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Stepper stages={stages} step={step} onJump={(n) => { setAck(""); goTo(n); }} />
        <p className="m-0 text-[14px] text-muted-foreground">
          {segment === "main"
            ? `שלב ${step} מתוך ${stages.length} · ${stages[step - 1].label}`
            : `שאלה ${step} מתוך ${stages.length} · ${stages[step - 1].label} · אפשר לדלג על כל שאלה`}
        </p>
        <div
          role="progressbar"
          aria-label="התקדמות בשאלון"
          aria-valuemin={1}
          aria-valuemax={stages.length}
          aria-valuenow={step}
          className="h-1 w-full rounded-full bg-border overflow-hidden"
        >
          <div className="h-full bg-highlight motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <p aria-live="polite" className="m-0 min-h-6 text-[16px] text-accent">
        {ack}
      </p>

      {id === "concern" ? (
        <div className="flex flex-col gap-5">
          {heading("מה מעסיק אותך?")}
          <fieldset className="flex flex-col gap-3 border-0 p-0 m-0 min-w-0">
            <legend className="font-heading text-[19px] md:text-[21px] mb-1">{CONCERN_LEGEND}</legend>
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
          {navigation(continueButton())}
        </div>
      ) : null}

      {id === "contact" ? (
        <form
          aria-label="פרטי קשר"
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            forward();
          }}
        >
          {heading("איך דורית תחזור אליך")}
          <p className="m-0 text-[16px] leading-relaxed text-foreground/80">{CONTACT_INTRO}</p>
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
          <p className="m-0 text-[15px] leading-relaxed text-muted-foreground">{TRANSPARENCY}</p>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <CtaButton muted onClick={back}>
              <ArrowRight size={18} aria-hidden="true" />
              הקודם
            </CtaButton>
            <CtaButton type="submit" disabled={submitting}>
              שליחה לדורית
              {submitting ? <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
            </CtaButton>
          </div>
          {/* What happens after the button (user feedback, 2026-10-14) — the
              same promise as CONFIRMATION_FOLLOW_UP. */}
          <p className="m-0 -mt-2 text-[15px] text-muted-foreground text-end">דורית חוזרת אליך תוך יום עסקים אחד.</p>
        </form>
      ) : null}

      {id === "life" ? (
        <div className="flex flex-col gap-5">
          {heading("נכיר קצת")}
          <Choices question={LIFE_STAGE} value={state.answers[LIFE_STAGE.key]} onChange={(v) => setAnswer(LIFE_STAGE.key, v)} withUnknown={false} pick={pick} />
          {navigation(continueButton())}
        </div>
      ) : null}

      {id === "goal" ? (
        <div className="flex flex-col gap-5">
          {heading("מה היית רוצה לקחת מהפגישה")}
          <Choices question={GOAL} value={state.answers[GOAL.key]} onChange={(v) => setAnswer(GOAL.key, v)} withUnknown={false} pick={pick} />
          {navigation(continueButton())}
        </div>
      ) : null}

      {id === "clearinghouse" ? (
        <div className="flex flex-col gap-5">
          {heading("תמונת מצב מהמסלקה")}
          <p className="m-0 text-[17px] leading-relaxed text-foreground/80">{CLEARINGHOUSE_TEXT}</p>
          <Choices question={CLEARINGHOUSE} value={state.answers[CLEARINGHOUSE.key]} onChange={(v) => setAnswer(CLEARINGHOUSE.key, v)} withUnknown={false} />
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
          {navigation(continueButton())}
        </div>
      ) : null}

      {id === "time" ? (
        <div className="flex flex-col gap-6">
          {heading("מתי נוח להיפגש?")}
          <fieldset className="flex flex-col gap-3 border-0 p-0 m-0 min-w-0">
            <legend className="font-heading text-[19px] md:text-[21px] mb-1">יום</legend>
            <div className="flex flex-wrap gap-2.5">
              {(["tomorrow", "this_week", "next_week", "date"] as DayChoice[])
                .filter((d) => (d === "tomorrow" ? days.tomorrow : d === "this_week" ? days.thisWeek : true))
                .map((d) => (
                  <label key={d}>
                    <input
                      type="radio"
                      name="nw-day"
                      value={d}
                      checked={state.day === d}
                      onChange={() => patch({ day: d })}
                      className="peer sr-only"
                    />
                    <span className={CHIP}>{DAY_LABELS[d]}</span>
                  </label>
                ))}
            </div>
          </fieldset>
          {state.day === "date" ? (
            <Field label="תאריך" className="max-w-[260px]">
              <input
                type="date"
                className={inputClass()}
                min={days.earliest}
                value={state.date ?? ""}
                aria-invalid={errors.date ? true : undefined}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value && (value < days.earliest || !isWorkingDay(value))) {
                    setErrors({ date: "אפשר לבחור יום ראשון עד חמישי, מחר והלאה." });
                    patch({ date: undefined });
                    return;
                  }
                  setErrors({});
                  patch({ date: value || undefined });
                }}
              />
            </Field>
          ) : null}
          {errors.date ? <p role="alert" className="m-0 text-destructive text-[15px]">{errors.date}</p> : null}
          <fieldset className="flex flex-col gap-3 border-0 p-0 m-0 min-w-0">
            <legend className="font-heading text-[19px] md:text-[21px] mb-1">שעות</legend>
            <div className="flex flex-wrap gap-2.5">
              {SLOTS.map((s) => (
                <label key={s.key}>
                  <input
                    type="radio"
                    name="nw-slot"
                    value={s.key}
                    checked={state.slot === s.key}
                    onChange={() => patch({ slot: s.key as SlotKey })}
                    className="peer sr-only"
                  />
                  <span className={CHIP}>{s.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="m-0 text-[15px] text-muted-foreground">{TIME_NOTE}</p>
          {navigation(continueButton("שמירת התשובות"))}
        </div>
      ) : null}
    </div>
  );
}
