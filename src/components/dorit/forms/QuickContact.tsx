import React, { useState } from "react";
import { services } from "@/services";
import { useSubmission } from "@/hooks/useSubmission";
import { leadEvents } from "@/lib/analytics";
import { getAttribution } from "@/lib/attribution";
import { CONTACT } from "@/config/contact";
import { HUMAN_HANDOFF } from "@/config/compliance";
import { isContactPhone } from "@/lib/phone";
import { CtaButton } from "@/components/dorit/primitives/Cta";
import { Field, inputClass } from "@/components/dorit/primitives/Field";
import { Send, Loader2, Check, Mail, MessageCircle } from "lucide-react";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { useLocale, useT } from "@/i18n/LocaleContext";
import { withFilledInNote } from "@/i18n/locales";

interface QuickContactForm {
  name: string;
  phone: string;
  email: string;
  message: string;
}

/**
 * What's missing or wrong, named rather than left to a greyed-out button to
 * imply. A phone Dorit could not call back is refused here, as `submit-lead`
 * refuses it — "abc" or "123" used to go through (D-01, manual test
 * 2026-10-14).
 */
function missingFieldsMessage(
  form: QuickContactForm
): "quick.errorBoth" | "quick.errorName" | "quick.errorPhone" | "quick.errorPhoneInvalid" | null {
  const missingName = !form.name.trim();
  const missingPhone = !form.phone.trim();
  if (missingName && missingPhone) return "quick.errorBoth";
  if (missingName) return "quick.errorName";
  if (missingPhone) return "quick.errorPhone";
  if (!isContactPhone(form.phone)) return "quick.errorPhoneInvalid";
  return null;
}

export default function QuickContact({ embedded = false, className }: { embedded?: boolean; className?: string }) {
  const [form, setForm] = useState<QuickContactForm>({ name: "", phone: "", email: "", message: "" });
  const [validationError, setValidationError] = useState<ReturnType<typeof missingFieldsMessage>>(null);
  const t = useT("home");
  const locale = useLocale();
  const { sending: busy, sent, error, submit, reset } = useSubmission("message");

  const send = async () => {
    const missing = missingFieldsMessage(form);
    if (missing) {
      setValidationError(missing);
      return;
    }
    setValidationError(null);
    const ok = await submit(() => {
      const attribution = getAttribution();
      return services.leads.submitLead({
        name: form.name,
        phone: form.phone,
        email: form.email,
        source: "quick",
        // The visitor's words as written, and — from the English or French
        // site — a Hebrew note for Dorit saying so.
        message: withFilledInNote(form.message, locale),
        channel: attribution?.channel,
        campaign: attribution?.campaign ?? undefined,
        landingPath: window.location.pathname,
      });
    });
    if (ok) {
      // A lead once it is saved — never on the click.
      leadEvents.formSubmitted();
      setForm({ name: "", phone: "", email: "", message: "" });
    }
  };

  // The form itself, drawn straight onto the page ground — no card around it.
  const formBody = (
    <div className={embedded ? "min-w-0" : "lg:col-span-7"}>
          {sent ? (
            <div className="border-y border-border py-14 px-6 text-center">
              <div className="w-14 h-14 mx-auto rounded-full border border-highlight flex items-center justify-center mb-6">
                <Check size={26} className="text-highlight" />
              </div>
              <p className="font-heading text-2xl">{t("quick.sentTitle")}</p>
              <p className="mt-4 text-muted-foreground">
                {t("quick.sentText")}
              </p>
              <button
                onClick={reset}
                className="mt-8 text-sm tracking-wide underline underline-offset-4 hover:text-accent transition-colors"
              >
                {t("quick.again")}
              </button>
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-5">
                <Field label={t("quick.name")}>
                  <input
                    id="qc-name"
                    value={form.name}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, name: e.target.value }));
                      setValidationError(null);
                    }}
                    autoComplete="name"
                    className={inputClass()}
                  />
                </Field>
                <Field label={t("quick.phone")}>
                  <input
                    id="qc-phone"
                    type="tel"
                    inputMode="tel"
                    value={form.phone}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, phone: e.target.value }));
                      setValidationError(null);
                    }}
                    placeholder={HUMAN_HANDOFF.phonePlaceholder}
                    autoComplete="tel"
                    aria-invalid={validationError === "quick.errorPhoneInvalid" || undefined}
                    className={inputClass()}
                  />
                </Field>
              </div>
              <Field label={t("quick.email")} className="mt-5">
                <input
                  id="qc-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className={inputClass()}
                />
              </Field>
              <Field label={t("quick.message")} className="mt-5">
                <textarea
                  id="qc-message"
                  value={form.message}
                  onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                  rows={3}
                  placeholder={t("quick.messagePlaceholder")}
                  className={inputClass("resize-none")}
                />
              </Field>

              {(validationError || error) && (
                <p role="alert" className="mt-5 text-sm text-destructive">
                  {validationError ? t(validationError) : error}
                </p>
              )}

              <div className="mt-7 flex justify-end">
                <CtaButton onClick={send} disabled={busy}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  {t("quick.send")}
                </CtaButton>
              </div>
            </div>
          )}
        </div>
  );

  // Embedded on the home page the <section> below is not rendered, so the id
  // lives on this wrapper: #quick-contact is what the anchor links, the
  // accessibility scans and the form tests all address. Heading and form sit
  // side by side, the form directly on the ground.
  if (embedded) {
    return (
      <div
        id="quick-contact"
        className={`grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-x-16 gap-y-8 border-t border-border pt-14 mt-4 max-md:pt-8 max-md:mt-0 max-md:gap-y-5${className ? ` ${className}` : ""}`}
      >
        <h3 className="font-heading font-normal text-[clamp(28px,3vw,36px)] leading-[1.2]">
          {t("quick.embeddedTitle")}
        </h3>
        {formBody}
      </div>
    );
  }

  return (
    <section id="quick-contact" className="relative py-24 md:py-32 bg-secondary text-foreground border-t border-border">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
        <div className="lg:col-span-5">
          <Eyebrow>
            {t("quick.eyebrow")}
          </Eyebrow>
          <h2 className="font-heading text-5xl md:text-6xl mt-5 leading-tight">
            {t("quick.titleLine1")}
            <br />
            {t("quick.titleLine2")}
          </h2>
          <p className="mt-8 text-muted-foreground max-w-md leading-relaxed">
            {t("quick.text")}
          </p>
          <div className="mt-8 flex items-center gap-3 text-muted-foreground">
            <Mail size={16} className="text-accent" />
            <a href={`mailto:${CONTACT.email}`} dir="ltr" className="hover:text-accent transition-colors">{CONTACT.email}</a>
          </div>
          <a
            href={`https://wa.me/${CONTACT.whatsapp}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-3 text-muted-foreground hover:text-accent transition-colors"
          >
            <MessageCircle size={16} className="text-accent" />
            <span dir="ltr">WhatsApp</span>
          </a>
        </div>
        {formBody}
      </div>
    </section>
  );
}