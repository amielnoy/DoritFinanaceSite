import React from "react";
import { CONTACT } from "@/config/contact";

type Props = {
  children: React.ReactNode;
  /** "section" (default) for one home-page section, "page" for the whole app. */
  scope?: "section" | "page";
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

  componentDidCatch(error: Error) {
    // Name and message only: no props, state or component stack that could carry visitor input.
    console.error("ErrorBoundary caught a render error:", error?.name, error?.message);
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
