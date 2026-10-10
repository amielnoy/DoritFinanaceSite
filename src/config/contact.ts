import { AGENCY_PROFILE } from "./agencyProfile";

export const CONTACT = {
  phoneE164: AGENCY_PROFILE.phoneE164, // לחיוג — בלי רווחים, בלי מקפים
  phoneDisplay: AGENCY_PROFILE.phoneDisplay, // לתצוגה בלבד
  whatsapp: AGENCY_PROFILE.whatsapp, // ל-wa.me — בלי + ובלי 0 מוביל
  email: AGENCY_PROFILE.email,
  // הודעה כללית, להקשר שאין לו פתיחה משלו (כמו Claims.tsx, שמנוסחת לאירוע ביטוחי).
  defaultWhatsappMessage: AGENCY_PROFILE.defaultWhatsappMessage,
};
