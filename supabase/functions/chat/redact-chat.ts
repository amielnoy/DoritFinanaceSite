/**
 * The chat's redaction: redact()'s rules (ID, card, bank account and IBAN),
 * except for the visitor's phone number, which the interview exists to take.
 *
 * redact() (log-support-chat/redact.js, kept identical to its Base44 copy) treats
 * any 6–8-digit run as an account number and any 9-digit run as an ID, so it
 * cut the 7-digit tail off `050-1234567` and took `031234567` for an ID. The
 * model read the stored text back, so it never saw the phone and the lead
 * could not be called.
 *
 * Here phone-shaped tokens are set aside, redact() runs on the rest, and the
 * phones are put back. redact() also clips at 2,000 characters; this does not
 * (the store clips at the column's 8,000), so the text is redacted in pieces.
 */
import { redact } from '../log-support-chat/redact.js';

/**
 * An Israeli phone, alone (no digit or letter touching it, nor a digit one
 * separator away, so no run is taken out of a card or an IBAN): mobile and
 * VoIP 05X / 07X with seven digits after, a landline 0[2-489] with seven, each
 * also as +972 / 972 without the leading 0; a `-` or a space may follow the
 * prefix and the third digit.
 */
const PHONE =
  /(?<![\w+])(?<!\d[- ])(?:\+?972[- ]?|0)(?:[57]\d|[2-489])[- ]?\d{3}[- ]?\d{4}(?!\w)(?![- ]\d)/g;

/** Text with no digits, so no redact() rule can match it, and no character a visitor types. */
const slot = (i: number) => `${String.fromCharCode(0xe100 + i)}`;
const SLOT = /([-])/g;

/** Small enough that redact()'s longest marker per matched digit keeps a piece under its 2,000-character clip. */
const PIECE = 800;

/** The Israeli ID check digit (Luhn with weights 1, 2). */
function validId(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const d = Number(digits[i]) * ((i % 2) + 1);
    sum += d > 9 ? d - 9 : d;
  }
  return sum % 10 === 0;
}

/**
 * Whether a phone-shaped token is a phone. A bare nine digits starting 0[2-489]
 * is also how an ID starting with 0 is written; when it passes the ID check
 * digit it is redacted as one (a landline written that way loses its number
 * one time in ten; a dash or a +972 keeps it).
 */
const isPhone = (token: string) => !(/^\d{9}$/.test(token) && validId(token));

/** redact() on text of any length: cut at a space that has no digit on both sides, so no rule's match is split. */
function redactUnclipped(text: string): string {
  let out = '';
  let rest = text;
  while (rest.length > PIECE) {
    let cut = -1;
    for (let i = PIECE; i > 0; i--) {
      if (/\s/.test(rest[i]) && !(/\d/.test(rest[i - 1]) && /\d/.test(rest[i + 1] ?? ''))) {
        cut = i;
        break;
      }
    }
    // No such space in a whole piece: cut anyway (a run this long is no ID, card or account).
    if (cut < 0) cut = PIECE;
    out += redact(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return out + redact(rest);
}

export function redactChat(text: string): string {
  if (!text) return '';
  const phones: string[] = [];
  const masked = text.replace(PHONE, (token) => {
    if (!isPhone(token)) return token;
    phones.push(token);
    return slot(phones.length - 1);
  });
  return redactUnclipped(masked).replace(SLOT, (whole, c: string) => phones[c.charCodeAt(0) - 0xe100] ?? whole);
}
