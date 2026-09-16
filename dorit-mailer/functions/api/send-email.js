/**
 * Cloudflare Pages Function — POST /api/send-email
 *
 * כל הדואר של האתר יוצא מכאן. מפתח Resend, כתובת השולח ורשימת הנמענים חיים
 * בהגדרות ה-Pages project ולא בקוד של האתר — זו הסיבה שהשירות הזה קיים.
 *
 * שלושה סוגי הודעות:
 *   type: "rendered" — הודעה שנבנתה כבר במלואה (subject/html/text) על ידי
 *                      פונקציות Base44. הן מחזיקות את התבניות של האתר, את
 *                      בריחת ה-HTML ואת redact() על טקסט שנכתב על ידי מודל,
 *                      ולכן מה שמגיע לכאן נשלח כפי שהוא. דורש אימות.
 *   type: "contact"  — טופס צור קשר (name, phone, email?, message?)
 *   type: "intake"   — סיכום ראיון היכרות (שדות מובנים + summary)
 *
 * משתני סביבה (Cloudflare Pages → Settings → Environment variables):
 *   RESEND_API_KEY   re_xxxxxxxx
 *   MAIL_FROM        "דורית גוב ארי <notifications@mail.govari-fin.co.il>"
 *                    חייבת להיות על הדומיין המאומת ב-Resend. לא על הדומיין
 *                    הראשי: govari-fin.co.il מפנה ל-Microsoft 365 עם SPF
 *                    שמסתיים ב--all, ושליחה ממנו תיכשל.
 *   MAIL_TO          dorit@govari-fin.co.il,amielnoy@gmail.com,amielnoy@outlook.com
 *                    רשימה מופרדת בפסיקים. כל נמען הוא ניסיון מסירה נפרד, כדי
 *                    שתיבה אחת שנכשלת לא תיקח איתה את השאר.
 *   MAILER_TOKEN     מחרוזת אקראית. חובה לכל בקשה, בלי יוצא מן הכלל. בלעדיה
 *                    הנקודה הזו היא ממסר דואר פתוח שכל אחד יכול לשלוח ממנו
 *                    בשם הסוכנות, מהדומיין המאומת שלה.
 *   ALLOWED_ORIGIN   https://safe-arch-plan.base44.app
 *                    CORS בלבד, ואינו אמצעי אבטחה: הוא נאכף על ידי דפדפנים
 *                    ומתעלמים ממנו לחלוטין curl או שרת. מה ששומר על הנקודה
 *                    הזו הוא הטוקן.
 */

const RESEND_URL = "https://api.resend.com/emails";
const MAX_LEN = { name: 100, phone: 30, email: 120, message: 3000, summary: 6000 };
/** גוף הודעה מוכנה יכול להיות ארוך — נספח תפעולי, פרופיל מלא ו-HTML. */
const MAX_RENDERED = { subject: 300, html: 200_000, text: 60_000 };

export async function onRequestOptions({ env }) {
  return new Response(null, { status: 204, headers: cors(env) });
}

export async function onRequestPost({ request, env }) {
  const headers = { "Content-Type": "application/json", ...cors(env) };

  if (!env.RESEND_API_KEY || !env.MAIL_TO || !env.MAIL_FROM) {
    return json({ ok: false, error: "server_not_configured" }, 500, headers);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400, headers);
  }

  // Every request, not only the ones that name their own recipient.
  //
  // The contact/intake types were meant for a form posting straight from the
  // browser, and nothing does: the site talks to Base44, and Base44 talks to
  // this. So that path was an unauthenticated way into an endpoint that sends
  // mail from a verified domain, with no user to justify it. One way in now.
  //
  // A honeypot and a Turnstile check lived here for that browser path. They are
  // gone with it — they defend against a stranger's browser, and a stranger no
  // longer gets this far. If a public form is ever added, it needs both back,
  // plus a decision about which types it may use.
  if (!isAuthorised(request, env)) {
    return json({ ok: false, error: "unauthorised" }, 401, headers);
  }

  const type = ["rendered", "intake", "contact"].includes(body.type) ? body.type : "contact";

  let mail;
  let recipients;

  if (type === "rendered") {
    mail = {
      subject: clip(body.subject, MAX_RENDERED.subject),
      html: clip(body.html, MAX_RENDERED.html),
      text: clip(body.text, MAX_RENDERED.text),
    };
    if (!mail.subject || (!mail.html && !mail.text)) {
      return json({ ok: false, error: "missing_content" }, 400, headers);
    }
    recipients = [clip(body.to, MAX_LEN.email)].filter(Boolean);
    if (!recipients.length) return json({ ok: false, error: "missing_recipient" }, 400, headers);
  } else {
    const data = sanitize(body, type);
    const validation = validate(data, type);
    if (validation) return json({ ok: false, error: validation }, 400, headers);
    mail = type === "intake" ? buildIntakeMail(data) : buildContactMail(data);
    recipients = staffRecipients(env);
  }

  // Reply-To is always the agency, never the visitor: an operations copy that
  // gets forwarded to a client must reply to Dorit and not to a mailbox nobody
  // reads. The first configured recipient is hers.
  const replyTo = staffRecipients(env)[0];

  // One attempt per recipient. A single address that Resend rejects — a typo, a
  // bounce, a suppression — must not decide whether anyone else was told.
  const results = await Promise.all(
    recipients.map((to) => deliver({ env, to, replyTo, mail, type })),
  );

  const sent = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  if (!sent.length) {
    return json({ ok: false, error: "send_failed", failed: failed.map((f) => f.reason) }, 502, headers);
  }
  return json(
    { ok: true, ids: sent.map((s) => s.id), ...(failed.length ? { failed: failed.map((f) => f.reason) } : {}) },
    200,
    headers,
  );
}

/* ---------- helpers ---------- */

/** Bearer token, compared in full. Absent MAILER_TOKEN means nothing is authorised. */
function isAuthorised(request, env) {
  if (!env.MAILER_TOKEN) return false;
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token.length > 0 && token === env.MAILER_TOKEN;
}

/** The configured staff mailboxes, in order. The first is the agency's. */
function staffRecipients(env) {
  return String(env.MAIL_TO || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function deliver({ env, to, replyTo, mail, type }) {
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [to],
        reply_to: replyTo || undefined,
        subject: mail.subject,
        html: mail.html || undefined,
        text: mail.text || undefined,
        tags: [{ name: "type", value: type }],
      }),
    });
    if (!res.ok) {
      // Log the provider's words for whoever reads the Cloudflare logs, but
      // never return them: they can carry the key or the recipient list.
      const err = await res.text().catch(() => "");
      console.error("Resend error", res.status, err);
      return { ok: false, reason: `http_${res.status}` };
    }
    const { id } = await res.json();
    return id ? { ok: true, id } : { ok: false, reason: "no_message_id" };
  } catch (e) {
    console.error("Resend request failed", e);
    return { ok: false, reason: "network_error" };
  }
}

function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers });
}

const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

function sanitize(b, type) {
  const base = {
    name: clip(b.name, MAX_LEN.name),
    phone: clip(b.phone, MAX_LEN.phone),
    email: clip(b.email, MAX_LEN.email),
    message: clip(b.message, MAX_LEN.message),
  };
  if (type !== "intake") return base;
  return {
    ...base,
    lifeStage: clip(b.lifeStage, 60),
    employment: clip(b.employment, 60),
    topic: clip(b.topic, 80),
    existingProducts: Array.isArray(b.existingProducts)
      ? b.existingProducts.slice(0, 15).map((p) => clip(p, 60))
      : [],
    mainConcern: clip(b.mainConcern, 500),
    preferredTime: clip(b.preferredTime, 80),
    summary: clip(b.summary, MAX_LEN.summary),
  };
}

function validate(d, type) {
  if (!d.name) return "missing_name";
  if (!d.phone || !/^[\d\s\-+()]{7,}$/.test(d.phone)) return "invalid_phone";
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return "invalid_email";
  if (type === "intake" && !d.summary && !d.mainConcern) return "missing_summary";
  return null;
}


const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function row(label, value) {
  if (!value || (Array.isArray(value) && !value.length)) return "";
  const v = Array.isArray(value) ? value.map(esc).join(", ") : esc(value).replace(/\n/g, "<br>");
  return `<tr><td style="padding:6px 10px;color:#666;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:6px 10px">${v}</td></tr>`;
}

function shell(title, rows) {
  return `<!doctype html><html dir="rtl" lang="he"><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1a1a1a;direction:rtl">
<h2 style="color:#1f3a5f;margin:0 0 12px">${esc(title)}</h2>
<table style="border-collapse:collapse;background:#f7f8fa;border-radius:8px">${rows}</table>
<p style="color:#999;font-size:12px;margin-top:16px">נשלח מאתר דורית גוב ארי · ${new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}</p>
</body></html>`;
}

function buildContactMail(d) {
  const subject = `פנייה חדשה מהאתר — ${d.name}`;
  const html = shell("פנייה חדשה מהאתר", [
    row("שם", d.name), row("טלפון", d.phone), row("אימייל", d.email), row("הודעה", d.message),
  ].join(""));
  const text = `פנייה חדשה מהאתר\nשם: ${d.name}\nטלפון: ${d.phone}\nאימייל: ${d.email || "-"}\n\n${d.message || ""}`;
  return { subject, html, text };
}

function buildIntakeMail(d) {
  const subject = `סיכום ראיון היכרות — ${d.name}${d.topic ? " · " + d.topic : ""}`;
  const html = shell("סיכום ראיון היכרות לקראת פגישה", [
    row("שם", d.name), row("טלפון", d.phone), row("אימייל", d.email),
    row("נושא הפגישה", d.topic), row("שלב חיים", d.lifeStage), row("תעסוקה", d.employment),
    row("מוצרים קיימים", d.existingProducts), row("הדאגה המרכזית", d.mainConcern),
    row("מועד מועדף", d.preferredTime), row("סיכום השיחה", d.summary),
  ].join(""));
  const text = [
    "סיכום ראיון היכרות", `שם: ${d.name}`, `טלפון: ${d.phone}`, `אימייל: ${d.email || "-"}`,
    `נושא: ${d.topic || "-"}`, `שלב חיים: ${d.lifeStage || "-"}`, `תעסוקה: ${d.employment || "-"}`,
    `מוצרים קיימים: ${d.existingProducts.join(", ") || "-"}`, `דאגה מרכזית: ${d.mainConcern || "-"}`,
    `מועד מועדף: ${d.preferredTime || "-"}`, "", d.summary,
  ].join("\n");
  return { subject, html, text };
}
