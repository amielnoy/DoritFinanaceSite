import { describe, expect, it } from "vitest";
import { redactChat } from "../../supabase/functions/chat/redact-chat.ts";

const ID = "[הושמט — מספר מזהה]";
const CARD = "[הושמט — מספר כרטיס]";
const ACCOUNT = "[הושמט — חשבון בנק]";
const NUMBER = "[הושמט — מספר]";

describe("redactChat", () => {
  it.each([
    "050-1234567",
    "050 1234567",
    "0501234567",
    "050-123-4567",
    "+972-50-1234567",
    "+972501234567",
    "972501234567",
    "03-1234567",
    "031234567",
    "+972-3-1234567",
    "077-1234567",
  ])("keeps the phone %s whole", (phone) => {
    expect(redactChat(`הטלפון שלי ${phone}, תודה`)).toBe(`הטלפון שלי ${phone}, תודה`);
  });

  it("still redacts an ID number (123456782)", () => {
    expect(redactChat("תעודת זהות 123456782")).toBe(`תעודת זהות ${ID}`);
  });

  it("redacts a nine-digit landline-shaped number that is a valid ID, written without a dash", () => {
    // 038888889 passes the ID check digit: an ID starting 03 is not kept as a phone.
    expect(redactChat("ת.ז. 038888889")).toBe(`ת.ז. ${ID}`);
  });

  it("still redacts a card number, spaced or not", () => {
    expect(redactChat("כרטיס 4580 1234 5678 9012")).toBe(`כרטיס ${CARD}`);
    expect(redactChat("כרטיס 4580123456789012")).toBe(`כרטיס ${CARD}`);
  });

  it("still redacts a bank account and an IBAN", () => {
    expect(redactChat("חשבון 1234567")).toBe(`חשבון ${NUMBER}`);
    expect(redactChat("IBAN IL620108000000099999999")).toBe(`IBAN ${ACCOUNT}`);
  });

  it("keeps the phone and redacts the ID in one message", () => {
    expect(redactChat("ת״ז 123456782 וטלפון 050-1234567")).toBe(`ת״ז ${ID} וטלפון 050-1234567`);
  });

  it("does not take a phone-shaped run out of a longer number", () => {
    expect(redactChat("כרטיס 0501-2345-6789-0123")).toBe(`כרטיס ${CARD}`);
  });

  it("never clips: a 3,000-character text comes back whole", () => {
    const long = `${"שלום עולם ".repeat(300)}050-1234567`;
    expect(long.length).toBeGreaterThan(3000);
    expect(redactChat(long)).toBe(long);
  });

  it("redacts past the 2,000th character too", () => {
    const out = redactChat(`${"א".repeat(2500)} 123456782`);
    expect(out).toBe(`${"א".repeat(2500)} ${ID}`);
  });

  it("answers an empty string for nothing", () => {
    expect(redactChat("")).toBe("");
  });
});
