import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Check, RotateCcw, Calendar } from "lucide-react";
import { QUESTIONS, buildRecommendations } from "@/lib/insurance-assessment";
import type { Answers } from "@/lib/insurance-assessment";
import { CtaLink } from "@/components/dorit/primitives/Cta";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import CalculatorLeadBox from "@/components/dorit/sections/CalculatorLeadBox";
import { assessmentMessageIn } from "@/i18n/tools";
import { leadEvents } from "@/lib/analytics";
import { TOOL_SECTION } from "@/config/tools";
import { useLocale, useLocalePath, useT } from "@/i18n/LocaleContext";
import type { KeyOf } from "@/i18n/resources";
import Glossed from "@/components/dorit/primitives/Glossed";

export default function InsuranceAssessment() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [done, setDone] = useState(false);
  const t = useT("tools");
  const tc = useT("common");
  const locale = useLocale();
  const lp = useLocalePath();

  const current = QUESTIONS[step];
  const progress = done ? 100 : (step / QUESTIONS.length) * 100;

  const choose = (value: string) => {
    const next = { ...answers, [current.id]: value };
    setAnswers(next);
    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
    } else {
      setDone(true);
      // The last answer is the explicit action that shows a result: one
      // `calculator_result` per completed self-check, the tool's name only.
      leadEvents.calculatorResult("insurance_assessment");
    }
  };

  const back = () => {
    if (step > 0) setStep(step - 1);
  };

  const restart = () => {
    setAnswers({});
    setStep(0);
    setDone(false);
  };

  const recs = done ? buildRecommendations(answers) : [];
  const priorityCount = recs.filter((r) => r.priority).length;

  return (
    <section id={TOOL_SECTION.assessment} className="py-16 md:py-24 bg-secondary/60 border-t border-border scroll-mt-28">
      <div className="max-w-[1200px] mx-auto px-[clamp(20px,4vw,40px)]">
        <div className="max-w-3xl mb-10">
          <Eyebrow>
            {t("assess.eyebrow")}
          </Eyebrow>
          <h2 className="font-heading font-bold text-[clamp(28px,3.2vw,40px)] mt-4 leading-tight">
            {t("assess.title")}
          </h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            <Glossed text={t("assess.intro")} />
          </p>
        </div>

        <div className="card-raised overflow-hidden">
          {/* Progress bar */}
          <div className="mx-8 md:mx-12 mt-8 md:mt-10 h-2 rounded-full bg-secondary overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-primary"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>

          <div className="p-8 md:p-12">
            <AnimatePresence mode="wait">
              {!done ? (
                <motion.div
                  key={current.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="flex items-center justify-between mb-8">
                    <span className="text-sm font-semibold text-accent">
                      {t("assess.questionOf", { n: step + 1, total: QUESTIONS.length })}
                    </span>
                    {step > 0 && (
                      <button
                        onClick={back}
                        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-accent transition-colors"
                      >
                        <ArrowLeft size={15} className="ltr:rotate-180" />
                        {t("assess.back")}
                      </button>
                    )}
                  </div>

                  <h3 className="font-heading font-bold text-2xl md:text-[28px] mb-2 leading-snug">
                    {t(`assess.q.${current.id}.label`)}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-8">{t(`assess.q.${current.id}.hint`)}</p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {current.options.map((opt) => {
                      const selected = answers[current.id] === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => choose(opt.value)}
                          className={`group text-start p-5 border rounded-xl transition-all duration-200 ${
                            selected
                              ? "border-primary bg-highlight/10 text-accent"
                              : "border-border bg-secondary/60 hover:border-highlight hover:bg-card"
                          }`}
                        >
                          <span className="flex items-center justify-between">
                            <span className="font-body font-semibold text-lg">{t(`assess.q.${current.id}.${opt.value}` as KeyOf<"tools">)}</span>
                            <span
                              className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                                selected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-muted-foreground/50 bg-card group-hover:border-accent"
                              }`}
                            >
                              {selected && <Check size={12} />}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="results"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="flex items-center justify-between mb-8">
                    <span className="text-sm font-semibold text-accent">
                      {t("assess.yourResult")}
                    </span>
                    <button
                      onClick={restart}
                      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-accent transition-colors"
                    >
                      <RotateCcw size={15} />
                      {t("assess.restart")}
                    </button>
                  </div>

                  <h3 className="font-heading font-bold text-3xl md:text-4xl mb-3 leading-tight">
                    {t("assess.count", { n: recs.length })}
                  </h3>
                  <p className="text-muted-foreground mb-12">
                    {priorityCount > 0
                      ? t("assess.priorities", { n: priorityCount })
                      : t("assess.noPriority")}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {recs.map((rec, idx) => {
                      const Icon = rec.icon;
                      return (
                        <motion.div
                          key={rec.id}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, delay: idx * 0.08 }}
                          className={`flex gap-5 p-6 md:p-7 border rounded-xl transition-colors duration-300 ${
                            rec.priority
                              ? "border-highlight/40 bg-highlight-muted/15 hover:bg-highlight-muted/25"
                              : "border-border bg-secondary/30 hover:bg-secondary/50"
                          }`}
                        >
                          <div
                            className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${
                              rec.priority ? "bg-primary text-primary-foreground" : "bg-card text-accent border border-border"
                            }`}
                          >
                            <Icon size={22} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2.5 mb-2">
                              <h4 className="font-heading font-bold text-xl">{t(`assess.rec.${rec.id}` as KeyOf<"tools">)}</h4>
                              {rec.priority && (
                                <span className="text-xs font-semibold text-highlight-ink bg-highlight/10 border border-highlight/30 px-2.5 py-0.5 rounded-full">
                                  {t("assess.highPriority")}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed"><Glossed text={t(`assess.why.${rec.reason}` as KeyOf<"tools">)} /></p>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>

                  <CalculatorLeadBox className="mt-12" message={assessmentMessageIn(locale, recs)} />

                  <div className="mt-8 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-5">
                    <p className="text-sm text-muted-foreground text-center sm:text-start">
                      {t("assess.general")}
                    </p>
                    {/* `/#start`, not `#start`: there is no #start on /tools. */}
                    <CtaLink href={lp("/#start")} className="whitespace-nowrap">
                      <Calendar size={18} />
                      {tc("cta.shortCall")}
                    </CtaLink>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-6 max-w-2xl leading-relaxed">
          {t("assess.disclaimer")}
        </p>
      </div>
    </section>
  );
}