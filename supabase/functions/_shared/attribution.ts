/** The closed marketing-channel vocabulary — the same list as src/lib/attribution.ts plus the server-only 'unknown'. tests/contract/edge-functions.contract.test.ts fails if it drifts from base44/functions/submitClaim. */
export const CHANNEL_TAXONOMY = [
  'google', 'facebook', 'instagram', 'linkedin', 'ai_assistant',
  'email', 'sms', 'referral', 'direct', 'unknown',
];

/** ערך סגור בלבד — ולעולם לא נאמן מהלקוח, גם אם הוא כבר סינן בצד שלו. */
export function validChannel(value: unknown): string | null {
  return typeof value === 'string' && CHANNEL_TAXONOMY.includes(value) ? value : null;
}

/** נקי מתווים לא בטוחים, מוגבל באורך — בדיוק כמו הסינון בצד הלקוח, לא במקומו. */
export function validCampaign(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  return cleaned || null;
}

/** נתיב יחסי בלבד — בלי query string ובלי סכימה. */
export function validLandingPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^\/[a-zA-Z0-9/_-]{0,80}$/.test(value) ? value : null;
}

/** שורת "הגיע/ה דרך", משותפת בין גרסת ה-HTML לגרסת הטקסט של אותו מייל. */
export function channelLine({ channel, campaign, landingPath }: { channel: string | null; campaign: string | null; landingPath: string | null }): string {
  if (!channel || channel === 'unknown') return '';
  let line = channel;
  if (campaign) line += ` / ${campaign}`;
  if (landingPath) line += ` (נחיתה: ${landingPath})`;
  return line;
}
