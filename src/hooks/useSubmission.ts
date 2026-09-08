import { useCallback, useRef, useState } from "react";
import { CONTACT } from "@/config/contact";

/**
 * מצב שליחה משותף לכל הטפסים באתר.
 * The one submission state machine every form on the site shares.
 *
 * Four forms previously implemented this by hand, under two different
 * vocabularies (`busy`/`sent` and `sending`/`done`), each with its own copy of
 * the failure message and the contact address written into the string. A change
 * to the address had to be found in prose in three files.
 */

export type SubmissionState = "idle" | "sending" | "sent" | "error";

/** What the visitor was trying to send, so the message can name it. */
export type SubmissionSubject = "message" | "form" | "request" | "report";

const NOUN: Record<SubmissionSubject, string> = {
  message: "את ההודעה",
  form: "את הטופס",
  request: "את הבקשה",
  report: "את הדיווח",
};

/**
 * The failure message, with the address interpolated from config rather than
 * embedded in the copy.
 */
export function submissionErrorMessage(subject: SubmissionSubject): string {
  return `לא הצלחנו לשלוח ${NOUN[subject]} כרגע. ניתן לשלוח מייל ישירות ל-${CONTACT.email} או לנסות שוב.`;
}

export interface UseSubmissionResult {
  state: SubmissionState;
  /** True while the request is in flight — drives disabled and spinner states. */
  sending: boolean;
  /** True once the request has succeeded — drives the thank-you panel. */
  sent: boolean;
  error: string;
  /**
   * Runs `task` once, guarding against double submission, and maps the outcome
   * onto the state machine. Resolves true when the task succeeded.
   */
  submit: (task: () => Promise<unknown>) => Promise<boolean>;
  /** Back to a blank form, e.g. behind a "send another" link. */
  reset: () => void;
}

export function useSubmission(subject: SubmissionSubject = "message"): UseSubmissionResult {
  const [state, setState] = useState<SubmissionState>("idle");
  const [error, setError] = useState<string>("");
  // A ref, not state: the guard has to be readable synchronously. A state
  // updater runs at render time, so two clicks in the same tick would both
  // read "idle" and both submit.
  const inFlight = useRef(false);

  const submit = useCallback(
    async (task: () => Promise<unknown>): Promise<boolean> => {
      // The guard lives here so no form has to remember it: a double click
      // must not produce two leads.
      if (inFlight.current) return false;
      inFlight.current = true;

      setState("sending");
      setError("");
      try {
        await task();
        setState("sent");
        return true;
      } catch {
        setError(submissionErrorMessage(subject));
        setState("error");
        return false;
      } finally {
        inFlight.current = false;
      }
    },
    [subject]
  );

  const reset = useCallback(() => {
    inFlight.current = false;
    setState("idle");
    setError("");
  }, []);

  return {
    state,
    sending: state === "sending",
    sent: state === "sent",
    error,
    submit,
    reset,
  };
}
