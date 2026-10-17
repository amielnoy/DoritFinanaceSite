import { CONTACT } from "@/config/contact";
import type { HumanContact } from "./ports";

/**
 * The contact details the visitor falls back to when the backend cannot be
 * reached at all. They come from the same static config as every other
 * channel on the site — no network is involved in reading it — so a visitor
 * who asked for a person is never left without one, and the number cannot
 * drift from the one in the footer.
 */
export const FALLBACK_CONTACT: HumanContact = {
  phoneDisplay: CONTACT.phoneDisplay,
  phoneE164: CONTACT.phoneE164,
  whatsapp: CONTACT.whatsapp,
  email: CONTACT.email,
};
