import { phoneKey } from "@/lib/lead-duplicates";

/**
 * One-click WhatsApp to a lead (feature 3): the lead's number as wa.me wants
 * it, and the agency's message with the lead's details in it.
 *
 * Everything here stays in the browser: the link opens the member's own
 * WhatsApp, and only the fact that a message was opened is logged
 * (log_lead_whatsapp) — never the number or the text.
 */

/** The message a new agency starts with; the Owner edits it on /admin/agency. Kept equal to the column default in 20261110000000_lead_whatsapp.sql. */
export const DEFAULT_LEAD_WHATSAPP_TEMPLATE = "היי {name}, כאן {agent} — קיבלתי את הפנייה שלך בנושא {topic}, מתי נוח לדבר?";

/** The lead's phone as wa.me's international number (972…), or null when it is no one's number. */
export function waNumber(phone: string | null | undefined): string | null {
  const national = phoneKey(phone);
  return national ? `972${national}` : null;
}

/**
 * The template with `{name}`, `{agent}` and `{topic}` filled. An empty agent
 * becomes "הסוכנות" and an empty topic "שפנית אלינו", so the sentence still reads.
 */
export function fillWhatsappTemplate(template: string, values: { name: string; agent: string; topic: string }): string {
  const fill: Record<string, string> = {
    name: values.name.trim(),
    agent: values.agent.trim() || "הסוכנות",
    topic: values.topic.trim() || "שפנית אלינו",
  };
  return template.replace(/\{(name|agent|topic)\}/g, (_, key: string) => fill[key]);
}

/** https://wa.me/972…?text=…, or null without a number to write to. */
export function leadWhatsappHref(phone: string | null | undefined, text: string): string | null {
  const number = waNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
}
