import React from "react";

export interface MaslekaStep {
  title: string;
  body: React.ReactNode;
}

/**
 * Screenshots by step number (1-based). None ship today — the clearinghouse
 * screens have not been captured — so an absent entry renders nothing, not a
 * placeholder. Pass `{ 2: <img … /> }` to add one.
 */
export type StepScreens = Partial<Record<number, React.ReactNode>>;

export default function MaslekaSteps({ steps, screenshots = {} }: { steps: MaslekaStep[]; screenshots?: StepScreens }) {
  return (
    <ol className="space-y-6">
      {steps.map((step, i) => {
        const shot = screenshots[i + 1];
        return (
          <li key={step.title} className="flex gap-4">
            <span
              aria-hidden="true"
              className="flex-none w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-heading"
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <h2 className="font-heading text-lg">{step.title}</h2>
              <div className="mt-1 text-muted-foreground leading-relaxed">{step.body}</div>
              {shot ? <figure className="mt-3 border border-border/60 overflow-hidden">{shot}</figure> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
