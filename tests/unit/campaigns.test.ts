import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMPAIGN_MESSAGE,
  campaignLink,
  campaignMessage,
  campaignProblem,
  hasOptOut,
  newCampaignCode,
  shareWhatsappHref,
} from "@/lib/campaigns";

describe("newCampaignCode", () => {
  it("is 12 random lower-case letters and digits, different every time", () => {
    const codes = new Set(Array.from({ length: 200 }, () => newCampaignCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{12}$/);
  });
});

describe("campaignLink", () => {
  it("opens the site's start section, tagged as the campaign", () => {
    expect(campaignLink("https://govari-fin.co.il", "k7x2m9qa1b2c")).toBe(
      "https://govari-fin.co.il/?utm_source=reactivation&utm_campaign=k7x2m9qa1b2c#start",
    );
  });

  it("does not double the slash of a site address that ends with one", () => {
    expect(campaignLink("https://govari-fin.co.il/", "abc12345")).toBe(
      "https://govari-fin.co.il/?utm_source=reactivation&utm_campaign=abc12345#start",
    );
  });
});

describe("the message", () => {
  const link = "https://govari-fin.co.il/?utm_source=reactivation&utm_campaign=abc12345#start";

  it("fills the agent and the link", () => {
    expect(campaignMessage("שלום, כאן {agent}: {link}\nלהסרה השב/י 'הסר'", { agent: "דורית", link })).toBe(
      `שלום, כאן דורית: ${link}\nלהסרה השב/י 'הסר'`,
    );
  });

  it("adds the link before the opt-out line when the message has no {link}", () => {
    expect(campaignMessage("שלום, כאן {agent}.\nלהסרה השב/י 'הסר'", { agent: "דורית", link })).toBe(
      `שלום, כאן דורית.\n${link}\nלהסרה השב/י 'הסר'`,
    );
  });

  it("starts from a default that has the agent, the link and an opt-out line", () => {
    expect(DEFAULT_CAMPAIGN_MESSAGE).toContain("{agent}");
    expect(DEFAULT_CAMPAIGN_MESSAGE).toContain("{link}");
    expect(hasOptOut(DEFAULT_CAMPAIGN_MESSAGE)).toBe(true);
    expect(campaignProblem({ name: "חזרה ללקוחות", message: DEFAULT_CAMPAIGN_MESSAGE })).toBeNull();
  });
});

describe("campaignProblem (what blocks saving)", () => {
  it("refuses a message without an opt-out line", () => {
    expect(campaignProblem({ name: "סתיו", message: "שלום {link}" })).toBe("ההודעה חייבת לכלול שורת הסרה (״להסרה השב/י ׳הסר׳״).");
  });

  it("refuses a blank name, a long name and a long message", () => {
    expect(campaignProblem({ name: "  ", message: DEFAULT_CAMPAIGN_MESSAGE })).toBe("לקמפיין צריך שם.");
    expect(campaignProblem({ name: "א".repeat(81), message: DEFAULT_CAMPAIGN_MESSAGE })).toBe("השם ארוך מדי (עד 80 תווים).");
    expect(campaignProblem({ name: "סתיו", message: `${"א".repeat(1000)} להסרה` })).toBe("ההודעה ארוכה מדי (עד 1,000 תווים).");
  });
});

describe("shareWhatsappHref", () => {
  it("opens WhatsApp with the message and no recipient, so the agent picks the contacts", () => {
    expect(shareWhatsappHref("היי {x}?")).toBe(`https://wa.me/?text=${encodeURIComponent("היי {x}?")}`);
  });
});
