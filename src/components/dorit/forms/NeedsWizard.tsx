import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  ClipboardCheck,
  Compass,
  FileSearch,
  ListChecks,
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
  CONCERN_LABEL,
  CONCERN_LEGEND,
  CONCERNS,
  CONFIRMATION_FOLLOW_UP,
  CONTACT_INTRO,
  DAY_LABELS,
  GOAL,
  LIFE_STAGE,
  MEETING_TOPICS,
  NOTES_HINT,
  SLOTS,
  TIME_NOTE,
  TRACK_QUESTIONS,
  TRANSPARENCY,
  UNKNOWN_LABEL,
  type DayChoice,
  type MeetingTopic,
  type Question,
  type SlotKey,
} from "@/config/needs-wizard";
import {
  emptyState,
  isClaim,
  meetingTopicOf,
  timingOf,
  toInterviewSummary,
  trackOf,
  valueOf,
  type Answer,
  type WizardState,
} from "@/lib/needs-wizard";
import { dayChoices, isWorkingDay } from "@/lib/wall-clock";
import { isIsraeliPhone } from "@/lib/phone";

/**
 * The needs interview as eight short screens of choices.
 *
 * It replaces the free-text interview chat as the primary path: the same fields
 * Dorit receives, in about two minutes and without a model in the loop, saved
 * through the same `submitInterview` the chat's close uses. The chat stays one
 * link away for anyone who would rather write. See `config/needs-wizard.ts`.
 */

/**
 * The eight stages, each with an icon that says what it is about — so a visitor
 * sees at a glance where they are, what is behind them and what is left.
 */
const STAGES: readonly { label: string; icon: LucideIcon }[] = [
  { label: "שלב חיים", icon: Users },
  { label: "מה מעסיק", icon: Compass },
  { label: "יעד", icon: Target },
  { label: "פרטים", icon: ListChecks },
  { label: "מסלקה", icon: FileSearch },
  { label: "מועד", icon: CalendarClock },
  { label: "פרטי קשר", icon: Phone },
  { label: "סיכום", icon: ClipboardCheck },
];
const STEP_COUNT = STAGES.length;
type Phase = "steps" | "claim" | "done" | "failed";

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
 * Labels show beside the icons from the tablet width up — on a phone eight
 * icons fit in a row, and the labels stay for screen readers.
 */
function Stepper({ step, onJump }: { step: number; onJump: (n: number) => void }) {
  return (
    <ol aria-label="שלבי השאלון" className="m-0 p-0 list-none grid grid-cols-8 gap-1 md:gap-2">
      {STAGES.map(({ label, icon: Icon }, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        const circle =
          // 32px on a phone: eight 40px circles and their gaps overflow a 375px
          // screen's content width and clip the outermost stages.
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

/** One question as a real radio group or checkbox group, inside a fieldset with its legend. */
function Choices({
  question,
  value,
  onChange,
  withUnknown,
}: {
  question: Question;
  value: Answer | undefined;
  onChange: (next: Answer | undefined) => void;
  withUnknown: boolean;
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
          <label key={option}>
            <input
              type={question.multi ? "checkbox" : "radio"}
              name={`nw-${question.key}`}
              value={option}
              checked={chosen.includes(option)}
              onChange={() => toggle(option)}
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
  const [step, setStep] = useState<number>(1);
  const [phase, setPhase] = useState<Phase>("steps");
  const [ack, setAck] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [changingTopic, setChangingTopic] = useState<boolean>(false);
  const [claim, setClaim] = useState<{ name: string; phone: string; error: string; sending: boolean; result: string }>({
    name: "",
    phone: "",
    error: "",
    sending: false,
    result: "",
  });
  const started = useRef<boolean>(false);
  const ackIndex = useRef<number>(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef<boolean>(false);

  // Focus follows the step — but only once the visitor has moved: on page
  // load the wizard must not pull the page down to itself.
  useEffect(() => {
    if (moved.current) headingRef.current?.focus();
  }, [step, phase]);

  const track = trackOf(state);
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

  /** The questions a step asks, for the acknowledgement it earns. */
  const questionsOf = (n: number): Question[] =>
    n === 1 ? [LIFE_STAGE] : n === 3 ? [GOAL] : n === 4 ? [...TRACK_QUESTIONS[track]] : n === 5 ? [CLEARINGHOUSE] : [];

  const acknowledgementFor = (n: number): string => {
    if (n === 2) return state.concern ? nextAnswered() : ACKNOWLEDGEMENTS.skipped;
    const qs = questionsOf(n);
    if (!qs.length) return "";
    const answers = qs.map((q) => state.answers[q.key]);
    const anyUnknown = answers.some((a) => a === UNKNOWN_LABEL || (Array.isArray(a) && a.includes(UNKNOWN_LABEL)));
    if (anyUnknown) return ACKNOWLEDGEMENTS.unknown;
    const anyAnswered = qs.some((q) => valueOf(q, state.answers[q.key], state));
    return anyAnswered ? nextAnswered() : ACKNOWLEDGEMENTS.skipped;
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

  const forward = () => {
    begin();
    if (step === 2 && isClaim(state.concern)) {
      moved.current = true;
      setAck("");
      setPhase("claim");
      return;
    }
    if (step === 7) {
      const found: Record<string, string> = {};
      if (!state.name.trim()) found.name = "נא למלא שם.";
      if (!isIsraeliPhone(state.phone)) found.phone = "נא להזין מספר טלפון ישראלי — מתחיל ב-0, 9–10 ספרות.";
      if (state.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email.trim())) {
        found.email = "כתובת המייל לא נראית תקינה.";
      }
      if (Object.keys(found).length) {
        setErrors(found);
        return;
      }
    }
    leadEvents.wizardStep(step);
    setAck(acknowledgementFor(step));
    goTo(step + 1);
  };

  const back = () => {
    setAck("");
    goTo(Math.max(1, step - 1));
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const attribution = getAttribution();
      const receipt = await services.leads.submitInterview({
        ...toInterviewSummary(state, new Date()),
        channel: attribution?.channel,
        campaign: attribution?.campaign ?? undefined,
        landingPath: window.location.pathname,
      });
      if (!receipt?.ok) throw new Error(`rejected${receipt?.rid ? ` rid=${receipt.rid}` : ""}`);
      leadEvents.wizardStep(STEP_COUNT);
      leadEvents.wizardCompleted();
      moved.current = true;
      setPhase("done");
    } catch (e) {
      // The answers stay where they are: a retry must not cost the visitor the
      // two minutes they just spent.
      console.warn("[wizard] submitInterview failed — showing direct channels", String(e));
      moved.current = true;
      setPhase("failed");
    } finally {
      setSubmitting(false);
    }
  };

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

  const continueButton = (props: { type?: "button" | "submit" } = {}) => (
    <CtaButton type={props.type ?? "button"} onClick={props.type === "submit" ? undefined : forward}>
      המשך
      <ArrowLeft size={18} aria-hidden="true" />
    </CtaButton>
  );

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
              setStep(2);
            }}
          >
            <ArrowRight size={18} aria-hidden="true" />
            הקודם
          </CtaButton>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    const timing = timingOf(state);
    return (
      <div className="flex flex-col gap-4" role="status">
        {heading("נשמר — תודה")}
        <p className="m-0 text-[17px] leading-relaxed">
          השאלון נשמר ונשלח לדורית. נושא הפגישה: {meetingTopicOf(state)}
          {timing ? `. מועד מבוקש: ${timing}` : ""}.
        </p>
        <p className="m-0 text-[17px] leading-relaxed">{CONFIRMATION_FOLLOW_UP}</p>
        <p className="m-0 text-[15px] leading-relaxed text-muted-foreground">{TRANSPARENCY}</p>
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
              setStep(STEP_COUNT);
            }}
          >
            חזרה לסיכום ולניסיון נוסף
          </CtaButton>
        </div>
      </div>
    );
  }

  const progress = Math.round((step / STEP_COUNT) * 100);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Stepper step={step} onJump={(n) => { setAck(""); goTo(n); }} />
        <p className="m-0 text-[14px] text-muted-foreground">
          שלב {step} מתוך {STEP_COUNT} · {STAGES[step - 1].label} · אפשר לדלג על כל שאלה
        </p>
        <div
          role="progressbar"
          aria-label="התקדמות בשאלון"
          aria-valuemin={1}
          aria-valuemax={STEP_COUNT}
          aria-valuenow={step}
          className="h-1 w-full rounded-full bg-border overflow-hidden"
        >
          <div className="h-full bg-highlight motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <p aria-live="polite" className="m-0 min-h-6 text-[16px] text-accent">
        {ack}
      </p>

      {step === 1 ? (
        <div className="flex flex-col gap-5">
          {heading("נכיר קצת")}
          <Choices question={LIFE_STAGE} value={state.answers[LIFE_STAGE.key]} onChange={(v) => setAnswer(LIFE_STAGE.key, v)} withUnknown={false} />
          {navigation(continueButton())}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-5">
          {heading("מה מביא אותך")}
          <fieldset className="flex flex-col gap-3 border-0 p-0 m-0 min-w-0">
            <legend className="font-heading text-[19px] md:text-[21px] mb-1">{CONCERN_LEGEND}</legend>
            <div className="flex flex-wrap gap-2.5">
              {CONCERNS.map((c) => (
                <label key={c.label}>
                  <input
                    type="radio"
                    name="nw-concern"
                    value={c.label}
                    checked={state.concern === c.label}
                    onChange={() => patch({ concern: c.label })}
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

      {step === 3 ? (
        <div className="flex flex-col gap-5">
          {heading("מה היית רוצה לקחת מהפגישה")}
          <Choices question={GOAL} value={state.answers[GOAL.key]} onChange={(v) => setAnswer(GOAL.key, v)} withUnknown={false} />
          {navigation(continueButton())}
        </div>
      ) : null}

      {step === 4 ? (
        <div className="flex flex-col gap-7">
          {heading("כמה פרטים, כדי שדורית תגיע מוכנה")}
          {TRACK_QUESTIONS[track].map((q) =>
            q.textOnly ? (
              <Field key={q.key} label={q.legend}>
                <input
                  className={inputClass()}
                  value={typeof state.answers[q.key] === "string" ? (state.answers[q.key] as string) : ""}
                  onChange={(e) => setAnswer(q.key, e.target.value || undefined)}
                  placeholder={q.textOnly.placeholder}
                  maxLength={300}
                />
              </Field>
            ) : (
              <div key={q.key} className="flex flex-col gap-3">
                <Choices question={q} value={state.answers[q.key]} onChange={(v) => setAnswer(q.key, v)} withUnknown />
                {q.revealsText && state.answers[q.key] === q.revealsText.option ? (
                  <Field label="אם תרצה/י לציין (לא חובה)">
                    <input
                      className={inputClass("max-w-[320px]")}
                      value={state.feesText ?? ""}
                      onChange={(e) => patch({ feesText: e.target.value })}
                      placeholder={q.revealsText.placeholder}
                      maxLength={60}
                    />
                  </Field>
                ) : null}
              </div>
            )
          )}
          {navigation(continueButton())}
        </div>
      ) : null}

      {step === 5 ? (
        <div className="flex flex-col gap-5">
          {heading("תמונת מצב מהמסלקה")}
          <p className="m-0 text-[17px] leading-relaxed text-foreground/80">{CLEARINGHOUSE_TEXT}</p>
          <Choices question={CLEARINGHOUSE} value={state.answers[CLEARINGHOUSE.key]} onChange={(v) => setAnswer(CLEARINGHOUSE.key, v)} withUnknown={false} />
          {navigation(continueButton())}
        </div>
      ) : null}

      {step === 6 ? (
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
          {navigation(continueButton())}
        </div>
      ) : null}

      {step === 7 ? (
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
            <Field label="שם">
              <input
                className={inputClass()}
                value={state.name}
                onChange={(e) => patch({ name: e.target.value })}
                autoComplete="name"
                required
                aria-invalid={errors.name ? true : undefined}
              />
            </Field>
            <Field label="טלפון">
              <input
                className={inputClass()}
                value={state.phone}
                onChange={(e) => patch({ phone: e.target.value })}
                placeholder={HUMAN_HANDOFF.phonePlaceholder}
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
                required
                aria-invalid={errors.phone ? true : undefined}
              />
            </Field>
            <Field label="אימייל — לבחירתך" className="sm:col-span-2">
              <input
                type="email"
                className={inputClass()}
                value={state.email}
                onChange={(e) => patch({ email: e.target.value })}
                autoComplete="email"
                dir="ltr"
                aria-invalid={errors.email ? true : undefined}
              />
            </Field>
          </div>
          {Object.values(errors).length ? (
            <ul role="alert" className="m-0 ps-5 text-destructive text-[15px]">
              {Object.entries(errors).map(([k, v]) => (
                <li key={k}>{v}</li>
              ))}
            </ul>
          ) : null}
          {navigation(continueButton({ type: "submit" }))}
        </form>
      ) : null}

      {step === 8 ? (
        <div className="flex flex-col gap-6">
          {heading("סיכום לפני שליחה")}
          <SummaryList state={state} onEdit={goTo} />
          <div className="flex flex-col gap-2 border-t border-border pt-5">
            <p className="m-0 text-[16px]">
              נושא הפגישה: <span className="font-medium">{meetingTopicOf(state)}</span>{" "}
              <button type="button" className={LINK} onClick={() => setChangingTopic((v) => !v)} aria-expanded={changingTopic}>
                שינוי
              </button>
            </p>
            {changingTopic ? (
              <fieldset className="flex flex-col gap-3 border-0 p-0 m-0 min-w-0">
                <legend className="text-[15px] text-foreground/80 mb-1">באיזה נושא להיפגש?</legend>
                <div className="flex flex-wrap gap-2.5">
                  {MEETING_TOPICS.map((t) => (
                    <label key={t}>
                      <input
                        type="radio"
                        name="nw-topic"
                        value={t}
                        checked={meetingTopicOf(state) === t}
                        onChange={() => patch({ topic: t as MeetingTopic })}
                        className="peer sr-only"
                      />
                      <span className={CHIP}>{t}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </div>
          <Field label="משהו נוסף שחשוב שדורית תדע?">
            <textarea
              className={inputClass("min-h-24 resize-y")}
              value={state.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              maxLength={600}
              aria-describedby="nw-notes-hint"
            />
          </Field>
          <p id="nw-notes-hint" className="-mt-4 m-0 text-[14px] text-muted-foreground">
            {NOTES_HINT}
          </p>
          {navigation(
            <CtaButton onClick={() => void submit()} disabled={submitting}>
              אישור ושליחה
              {submitting ? (
                <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <Send size={18} aria-hidden="true" />
              )}
            </CtaButton>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Every answered field, labelled — a list, never prose — with a way back to it. */
function SummaryList({ state, onEdit }: { state: WizardState; onEdit: (step: number) => void }) {
  const rows: { label: string; value: string; step: number }[] = [];
  const add = (label: string, value: string | undefined, step: number) => {
    if (value) rows.push({ label, value, step });
  };
  add(LIFE_STAGE.label, valueOf(LIFE_STAGE, state.answers[LIFE_STAGE.key], state), 1);
  add(CONCERN_LABEL, state.concern, 2);
  add(GOAL.label, valueOf(GOAL, state.answers[GOAL.key], state), 3);
  for (const q of TRACK_QUESTIONS[trackOf(state)]) add(q.label, valueOf(q, state.answers[q.key], state), 4);
  add(CLEARINGHOUSE.label, valueOf(CLEARINGHOUSE, state.answers[CLEARINGHOUSE.key], state), 5);
  add("מועד מבוקש", timingOf(state), 6);
  add("שם", state.name.trim(), 7);
  add("טלפון", state.phone.trim(), 7);
  add("אימייל", state.email.trim(), 7);

  return (
    <dl className="m-0 flex flex-col divide-y divide-border border-y border-border">
      {rows.map((r) => (
        <div key={`${r.label}-${r.step}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
          <dt className="text-[15px] text-muted-foreground min-w-[160px]">{r.label}</dt>
          <dd className="m-0 flex-1 text-[16px]">{r.value}</dd>
          <dd className="m-0">
            <button type="button" className={LINK} onClick={() => onEdit(r.step)}>
              עריכה<span className="sr-only"> — {r.label}</span>
            </button>
          </dd>
        </div>
      ))}
    </dl>
  );
}
