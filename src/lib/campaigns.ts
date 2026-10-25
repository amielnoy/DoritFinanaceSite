/**
 * Reactivation campaigns, stage 1: the general link an agency sends its own
 * existing clients, and the WhatsApp message that carries it.
 *
 * The link is the site tagged ?utm_source=reactivation&utm_campaign=<code>;
 * src/lib/attribution.ts records it (overriding first touch, unlike any other
 * link) and submit-lead saves it on the lead as channel and campaign. The code
 * is random, so it says nothing about the agency, the campaign or the person.
 */

/** The message a new campaign starts with. {agent} and {link} are filled when the agent copies it. */
export const DEFAULT_CAMPAIGN_MESSAGE =
  "שלום, כאן {agent}. עבר זמן מאז שדיברנו — אשמח לשמוע בכמה דקות מה השתנה אצלך, כדי לוודא שהתיק שלך עדיין מתאים לך: {link}\nלהסרה מרשימת התפוצה השב/י 'הסר'";

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** 12 random lower-case letters and digits (~62 bits): campaigns.code's shape, and safe through attribution's sanitising. */
export function newCampaignCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  // 256 is not a multiple of 36; the bias is a few parts in a thousand, and the
  // code only has to be unpredictable enough not to be guessed or typed by chance.
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** The campaign's general link: the home page's start section, tagged. */
export function campaignLink(siteUrl: string, code: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/?utm_source=reactivation&utm_campaign=${code}#start`;
}

/** Whether a message carries the opt-out line every campaign message must have. */
export function hasOptOut(message: string): boolean {
  return message.includes("להסרה");
}

/**
 * The message with {agent} and {link} filled. A message without {link} gets the
 * link on its own line, before the opt-out line — a campaign message is
 * useless without it.
 */
export function campaignMessage(template: string, values: { agent: string; link: string }): string {
  const filled = template.replace(/\{agent\}/g, values.agent.trim() || "הסוכנות");
  if (filled.includes("{link}")) return filled.replace(/\{link\}/g, values.link);
  const lines = filled.split("\n");
  const optOut = lines.findIndex((l) => l.includes("להסרה"));
  if (optOut < 0) return `${filled}\n${values.link}`;
  return [...lines.slice(0, optOut), values.link, ...lines.slice(optOut)].join("\n");
}

/** Why a campaign cannot be saved, in Hebrew; null when it can. The table refuses the same (campaigns' checks). */
export function campaignProblem(campaign: { name: string; message: string }): string | null {
  const name = campaign.name.trim();
  if (!name) return "לקמפיין צריך שם.";
  if (name.length > 80) return "השם ארוך מדי (עד 80 תווים).";
  if (!hasOptOut(campaign.message)) return "ההודעה חייבת לכלול שורת הסרה (״להסרה השב/י ׳הסר׳״).";
  if (campaign.message.length > 1000) return "ההודעה ארוכה מדי (עד 1,000 תווים).";
  return null;
}

/** WhatsApp with the message and no recipient: the agent chooses whom to send it to. */
export function shareWhatsappHref(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
