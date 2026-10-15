/**
 * What the team that operates the site is told of an enquiry (Architecture
 * N-02; the user's decision of 2026-10-15): that it arrived, what kind it is,
 * how its delivery went, and where to read it — never who sent it.
 *
 * Dorit (SECONDARY_EMAIL) still receives the full enquiry; NOTIFY_EMAILS gets
 * this. Each mailbox copy of a visitor's details is one that no deletion in
 * the database reaches, and the team needs the record only when something
 * went wrong — which it reads in /admin/leads, where deletion does reach.
 *
 * Every value passed in must be non-identifying: a kind, a topic picked from
 * a list, a record id, a delivery status. A name, phone, email or free text
 * does not belong here, and the integration tests check each sender for them.
 */
import { escapeHtml } from './html.ts';

export const ADMIN_LEADS_URL = 'https://govari-fin.co.il/admin/leads';

export interface OpsNotice {
  subject: string;
  text: string;
  html: string;
}

/** A row: its label, its value, and — for a status that points somewhere, like the sheet row — a plain https:// link. */
export type OpsRow = [label: string, value: string, href?: string];

const plainHttps = (href: string | undefined): href is string => !!href && /^https:\/\/[^\s"'<>]+$/.test(href);

export function opsNotice(title: string, rows: OpsRow[]): OpsNotice {
  const lines = rows.map(([label, value, href]) => `${label}: ${value || '—'}${plainHttps(href) ? ` — ${href}` : ''}`);
  const text = [
    title,
    '',
    ...lines,
    '',
    `הפרטים המלאים במסך הפניות: ${ADMIN_LEADS_URL}`,
    'פרטי הפונה אינם נשלחים לתיבה זו — הם אצל דורית ובמאגר בלבד.',
  ].join('\n');
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1c1a19">
  <p style="font-weight:bold;margin:0 0 12px">${escapeHtml(title)}</p>
  <table role="presentation" style="border-collapse:collapse">${rows
    .map(([label, value, href]) => {
      const shown = escapeHtml(value || '—');
      // The address goes in the href, never in the cell: a URL as cell text wraps and is not clickable.
      const cell = plainHttps(href) ? `<a href="${escapeHtml(href)}">${shown}</a>` : shown;
      return `<tr><td style="padding:2px 0 2px 16px;color:#605d5d">${escapeHtml(label)}</td><td style="padding:2px 0">${cell}</td></tr>`;
    })
    .join('')}</table>
  <p style="margin:16px 0 0"><a href="${ADMIN_LEADS_URL}">הפרטים המלאים במסך הפניות</a></p>
  <p style="margin:8px 0 0;color:#605d5d;font-size:13px">פרטי הפונה אינם נשלחים לתיבה זו — הם אצל דורית ובמאגר בלבד.</p>
</div>`;
  return { subject: title, text, html };
}
