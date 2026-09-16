/**
 * Cloudflare Pages Function — POST /api/send-email
 *
 * שולח מייל דרך Resend. המפתח נשאר בשרת (env.RESEND_API_KEY).
 * תומך בשני סוגי הודעות:
 *   type: "contact"  — טופס צור קשר (name, phone, email?, message?)
 *   type: "intake"   — סיכום ראיון היכרות מהסוכן (שדות מובנים + summary)
 *
 * משתני סביבה (Cloudflare Pages → Settings → Environment variables):
 *   RESEND_API_KEY   re_xxxxxxxx
 *   MAIL_TO          dorit@govari-fin.co.il          (נמען)
 *   MAIL_FROM        "דורית גוב ארי <site@govari-fin.co.il>"  (דומיין מאומת ב-Resend)
 *   ALLOWED_ORIGIN   https://safe-arch-plan.base44.app  (אופציונלי, ל-CORS)
 *   TURNSTILE_SECRET (אופציונלי) — אם מוסיפים Cloudflare Turnstile בטופס
 */

const RESEND_URL = "https://api.resend.com/emails";
const MAX_LEN = { name: 100, phone: 30, email: 120, message: 3000, summary: 6000 };

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

  // Honeypot — שדה נסתר שבני אדם לא ממלאים
  if (body.website) return json({ ok: true }, 200, headers);

  // Turnstile (אופציונלי)
  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstileToken, request);
    if (!ok) return json({ ok: false, error: "captcha_failed" }, 403, headers);
  }

  const type = body.type === "intake" ? "intake" : "contact";
  const data = sanitize(body, type);

  const validation = validate(data, type);
  if (validation) return json({ ok: false, error: validation }, 400, headers);

  const mail = type === "intake" ? buildIntakeMail(data) : buildContactMail(data);

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [env.MAIL_TO],
      reply_to: data.email || undefined,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      tags: [{ name: "type", value: type }],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    console.error("Resend error", res.status, err);
    return json({ ok: false, error: "send_failed" }, 502, headers);
  }

  const { id } = await res.json();
  return json({ ok: true, id }, 200, headers);
}

/* ---------- helpers ---------- */

function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

async function verifyTurnstile(secret, token, request) {
  if (!token) return false;
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      response: token,
      remoteip: request.headers.get("CF-Connecting-IP"),
    }),
  });
  const j = await r.json().catch(() => ({}));
  return !!j.success;
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
