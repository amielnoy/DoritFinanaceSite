import { useEffect, useRef } from "react";
import { leadEvents, type CalculatorTool } from "@/lib/analytics";
import { RESULT_SETTLE_MS } from "@/lib/calculator-lead";

/**
 * `calculator_result` for a calculator that recomputes on every keystroke.
 *
 * The rule: a result counts once the visitor has produced it and then left the
 * inputs alone for `RESULT_SETTLE_MS` — so typing "3000" is one result, not
 * four — and each distinct result counts once per visit to the page, so going
 * back to one already seen sends nothing new.
 *
 * `key` names the result: the inputs it was computed from, or `null` while
 * there is nothing to count (the defaults nobody touched, or no result at
 * all). A calculator that shows its result on an explicit action — the
 * insurance self-check's last answer — needs none of this and sends from that
 * action.
 */
export function useCalculatorResultEvent(tool: CalculatorTool, key: string | null): void {
  const counted = useRef(new Set<string>());
  useEffect(() => {
    if (key === null || counted.current.has(key)) return;
    const timer = window.setTimeout(() => {
      counted.current.add(key);
      leadEvents.calculatorResult(tool);
    }, RESULT_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [tool, key]);
}
