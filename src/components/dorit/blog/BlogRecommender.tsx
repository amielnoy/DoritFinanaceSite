import React, { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import AgentChat from "@/components/dorit/chat/AgentChat";
import { AGENTS } from "@/config/agents";
import { CONSENT } from "@/config/compliance";
import { inputClass } from "@/components/dorit/primitives/Field";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { FOCUS_RING } from "./ArticleCard";

/**
 * "Not sure where to start?" — one field on the page, the full chat in a dialog.
 *
 * The chat used to sit above the articles with its whole consent notice open,
 * which put the first card ~2,300px down on a phone. The notice itself is
 * a gate: it still holds back the first message inside AgentChat, and the text
 * typed here only pre-fills the chat's input. Its wording is the one-line
 * version the compliance adviser approved (COMPLIANCE.md §9).
 *
 * Closing the dialog ends the conversation; the recommendation it produced
 * lives on the page and stays. Keeping the dialog mounted while closed would
 * keep the chat too, but a mounted modal leaves `aria-hidden` on the rest of
 * the page — the whole blog would vanish for a screen reader once it closed.
 */
export default function BlogRecommender({
  onAssistantMessage,
}: {
  onAssistantMessage: (content: string) => void;
}) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setDraft(text.trim());
    setOpen(true);
  };

  return (
    <section
      aria-labelledby="blog-recommender-title"
      data-track-location="blog_recommender"
      className="border border-border rounded-md bg-card p-6 md:p-8"
    >
      <h2 id="blog-recommender-title" className="font-heading text-2xl md:text-3xl text-foreground">
        לא בטוחים מאיפה להתחיל?
      </h2>
      <form onSubmit={submit} className="mt-4 flex flex-col sm:flex-row gap-3">
        <label htmlFor="blog-recommender-input" className="sr-only">
          ספרו בקצרה מה קרה אצלכם
        </label>
        <input
          id="blog-recommender-input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="למשל: ״החלפתי עבודה״ או ״נולד לנו ילד״"
          className={inputClass("flex-1 min-h-12 px-4 text-base")}
        />
        <button type="submit" className={ctaClass("shrink-0")}>
          המליצו לי
        </button>
      </form>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        עוזר אוטומטי של דורית, לא ייעוץ. אין לכתוב תעודת זהות או מספרי פוליסה.{" "}
        <a
          href={CONSENT.privacyHref}
          className={`text-accent underline underline-offset-4 decoration-highlight/50 hover:decoration-highlight ${FOCUS_RING}`}
        >
          מדיניות הפרטיות
        </a>
      </p>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed z-50 inset-x-0 bottom-0 max-h-[100dvh] overflow-y-auto bg-background border-t border-border p-4 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[min(92vw,820px)] md:border md:rounded-md md:p-6"
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              <DialogPrimitive.Title className="font-heading text-xl text-foreground">
                {AGENTS.blogRecommender.panelTitle}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label="סגירה"
                className={`w-11 h-11 inline-flex items-center justify-center rounded-md text-foreground hover:text-accent ${FOCUS_RING}`}
              >
                <X size={20} aria-hidden="true" />
              </DialogPrimitive.Close>
            </div>
            <AgentChat
              descriptor={AGENTS.blogRecommender}
              embedded
              initialInput={draft}
              onAssistantMessage={onAssistantMessage}
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </section>
  );
}
