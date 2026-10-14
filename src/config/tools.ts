/**
 * The /tools page's section ids — one name for the section and for every link
 * to it (the home page's tools strip). The retirement and Har HaBituach
 * sections arrive in the snapshot programme's phases 2 and 3.
 */
export const TOOL_SECTION = {
  feeCalculator: "fee-calculator",
  assessment: "assessment",
  retirement: "retirement",
  harHabituach: "har-habituach",
} as const;

export const toolHref = (section: (typeof TOOL_SECTION)[keyof typeof TOOL_SECTION]): string => `/tools#${section}`;
