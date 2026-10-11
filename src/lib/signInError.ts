/**
 * Supabase answers in English, and a visitor here reads Hebrew. The two
 * refusals a person can act on get their own sentence; anything else gets a
 * plain "try again" rather than a raw English string from the provider.
 */
export function signInErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (/invalid login credentials/i.test(message)) return "כתובת הדוא״ל או הסיסמה שגויים.";
  if (/email not confirmed/i.test(message)) return "כתובת הדוא״ל עוד לא אומתה. חפשו אצלכם מייל אימות ולחצו על הקישור שבו.";
  return "לא הצלחנו להתחבר כרגע. נסו שוב בעוד רגע.";
}
