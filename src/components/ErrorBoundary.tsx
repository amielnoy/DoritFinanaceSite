import React from "react";
import { CONTACT } from "@/config/contact";
import { checkFreshness, isChunkLoadError, reloadFresh } from "@/lib/freshness";

type Props = {
  children: React.ReactNode;
  /** "section" (default) for one home-page section, "page" for the whole app. */
  scope?: "section" | "page";
  /**
   * When this changes, a caught failure is forgotten and the children render
   * again. The app-level boundary passes the path, so leaving a broken page by
   * any link (header, footer, back button) recovers instead of keeping the
   * fallback on every page after it.
   */
  resetKey?: unknown;
};

type State = { failed: boolean };

/**
 * Keeps a render-time throw from unmounting the whole app. The fallback always
 * offers Dorit's contact details, so a broken section never strands a visitor.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  componentDidCatch(error: Error) {
    // Name and message only: no props, state or component stack that could carry visitor input.
    console.error("ErrorBoundary caught a render error:", error?.name, error?.message);
    // A page chunk that would not load is how a tab left open through a deploy
    // breaks. `vite:preloadError` already asks the freshness check; asking here
    // too covers a failure that event did not report. A stale build moves the
    // tab to the new one; a fresh one leaves this fallback and its reload button.
    if (isChunkLoadError(error)) void checkFreshness();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const text =
      this.props.scope === "page" ? "משהו השתבש בטעינת הדף." : "משהו השתבש בטעינת החלק הזה.";
    return (
      <div dir="rtl" className="mx-auto max-w-xl px-4 py-8 text-center">
        <p role="alert" className="mb-3">
          {text}
        </p>
        {/* Most failures here are a page that did not load — a deploy since the
            tab was opened, or a dropped connection — and a fresh load fixes them. */}
        <button
          type="button"
          onClick={reloadFresh}
          className="mb-5 inline-flex min-h-11 items-center rounded-md border border-highlight px-5 text-highlight-foreground hover:bg-highlight/[0.12]"
        >
          לטעון את הדף מחדש
        </button>
        <p className="mb-3">אפשר ליצור קשר ישירות עם דורית:</p>
        <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <li>
            <a href={`tel:${CONTACT.phoneE164}`} className="underline">
              {CONTACT.phoneDisplay}
            </a>
          </li>
          <li>
            <a
              href={`https://wa.me/${CONTACT.whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              וואטסאפ
            </a>
          </li>
          <li>
            <a href={`mailto:${CONTACT.email}`} className="underline">
              {CONTACT.email}
            </a>
          </li>
        </ul>
      </div>
    );
  }
}
