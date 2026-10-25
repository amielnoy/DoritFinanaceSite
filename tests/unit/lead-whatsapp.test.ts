import { describe, expect, it } from "vitest";
import { DEFAULT_LEAD_WHATSAPP_TEMPLATE, fillWhatsappTemplate, leadWhatsappHref, waNumber } from "@/lib/lead-whatsapp";
import { statusAfterWhatsapp } from "@/lib/lead-pipeline";

describe("waNumber", () => {
  it("turns any Israeli spelling into wa.me's 972 form", () => {
    expect(waNumber("054-123-4567")).toBe("972541234567");
    expect(waNumber("+972 54 1234567")).toBe("972541234567");
    expect(waNumber("972541234567")).toBe("972541234567");
    expect(waNumber("0541234567")).toBe("972541234567");
    expect(waNumber("03-1234567")).toBe("97231234567");
  });

  it("has no number for an empty, anonymised or too-short phone", () => {
    expect(waNumber("")).toBeNull();
    expect(waNumber(null)).toBeNull();
    expect(waNumber("050")).toBeNull();
    expect(waNumber("0501234")).toBeNull();
  });
});

describe("fillWhatsappTemplate", () => {
  it("fills the name, the agent and the topic", () => {
    expect(fillWhatsappTemplate(DEFAULT_LEAD_WHATSAPP_TEMPLATE, { name: "רחל", agent: "דורית", topic: "פנסיה" })).toBe(
      "היי רחל, כאן דורית — קיבלתי את הפנייה שלך בנושא פנסיה, מתי נוח לדבר?",
    );
  });

  it("fills every occurrence, trims the values, and leaves unknown braces as they are", () => {
    expect(fillWhatsappTemplate("{name}/{name} {other}", { name: " דנה ", agent: "", topic: "" })).toBe("דנה/דנה {other}");
  });

  it("says something sensible when the lead has no topic or the agent no name", () => {
    expect(fillWhatsappTemplate(DEFAULT_LEAD_WHATSAPP_TEMPLATE, { name: "רחל", agent: "", topic: "" })).toBe(
      "היי רחל, כאן הסוכנות — קיבלתי את הפנייה שלך בנושא שפנית אלינו, מתי נוח לדבר?",
    );
  });
});

describe("leadWhatsappHref", () => {
  it("opens a chat with the lead's number and the message, encoded", () => {
    expect(leadWhatsappHref("054-1234567", "היי רחל?")).toBe(`https://wa.me/972541234567?text=${encodeURIComponent("היי רחל?")}`);
  });

  it("has no link without a number to write to", () => {
    expect(leadWhatsappHref("050", "היי")).toBeNull();
  });
});

describe("statusAfterWhatsapp", () => {
  it("moves a new lead to נוצר קשר, and leaves any other where it is", () => {
    expect(statusAfterWhatsapp("new")).toBe("contacted");
    expect(statusAfterWhatsapp("contacted")).toBeNull();
    expect(statusAfterWhatsapp("meeting_set")).toBeNull();
    expect(statusAfterWhatsapp("escalated")).toBeNull();
    expect(statusAfterWhatsapp("client")).toBeNull();
  });
});
