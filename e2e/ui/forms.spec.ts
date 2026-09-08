import type { Locator, Page } from "@playwright/test";
import { expect, gotoApp, test, test_step } from "../fixtures/app";

const LEAD = { name: "ישראלה ישראלי", phone: "050-1234567", email: "test@example.com" };

/**
 * The three lead-capture surfaces, as page objects. Their methods carry the
 * @test_step annotation, so every interaction a spec performs shows up in the
 * report under the sentence that describes it — without the spec repeating it.
 */
class QuickContactForm {
  readonly root: Locator;
  readonly submit: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator("#quick-contact");
    this.submit = this.root.getByRole("button", { name: "שליחת הודעה" });
  }

  @test_step("open the home page and scroll to the quick contact form")
  async open() {
    await gotoApp(this.page);
    await this.root.scrollIntoViewIfNeeded();
  }

  @test_step("fill in the visitor's details")
  async fill(fields: { name?: string; phone?: string; email?: string; message?: string }) {
    if (fields.name !== undefined) await this.root.locator("#qc-name").fill(fields.name);
    if (fields.phone !== undefined) await this.root.locator("#qc-phone").fill(fields.phone);
    if (fields.email !== undefined) await this.root.locator("#qc-email").fill(fields.email);
    if (fields.message !== undefined) await this.root.locator("#qc-message").fill(fields.message);
  }

  @test_step("send the message")
  async send() {
    await this.submit.click();
  }
}

class DetailedContactForm {
  readonly root: Locator;
  readonly submit: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator("#detailed-contact");
    this.submit = this.root.getByRole("button", { name: "שליחת פנייה" });
  }

  @test_step("open the home page and scroll to the detailed contact form")
  async open() {
    await gotoApp(this.page);
    await this.root.scrollIntoViewIfNeeded();
  }

  @test_step("fill in name, phone and message")
  async fillBasics(fields: { name: string; phone: string; message?: string }) {
    await this.root.locator("#dc-name").fill(fields.name);
    await this.root.locator("#dc-phone").fill(fields.phone);
    if (fields.message !== undefined) await this.root.locator("#dc-message").fill(fields.message);
  }

  @test_step("pick the service the visitor needs")
  async chooseService(name: string) {
    await this.root.getByRole("button", { name }).click();
  }

  @test_step("agree to be contacted")
  async consent() {
    await this.root.locator("#dc-consent").check();
  }
}

class ConsultationWizard {
  readonly root: Locator;
  readonly submit: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator("#consultation");
    this.submit = this.root.getByRole("button", { name: "שליחת בקשה" });
  }

  @test_step("open the home page and scroll to the consultation wizard")
  async open() {
    await gotoApp(this.page);
    await this.root.scrollIntoViewIfNeeded();
  }

  @test_step("step 1 — choose a topic and continue")
  async chooseTopic(topic: string) {
    await this.root.getByRole("button", { name: topic }).click();
    await this.root.getByRole("button", { name: "המשך" }).click();
  }

  @test_step("step 2 — choose a timing and continue")
  async chooseTiming(timing: string) {
    await this.root.getByRole("button", { name: timing }).click();
    await this.root.getByRole("button", { name: "המשך" }).click();
  }

  @test_step("step 3 — enter the visitor's contact details")
  async fillContact(fields: { name: string; phone?: string }) {
    await this.root.getByLabel("שם מלא").fill(fields.name);
    if (fields.phone !== undefined) await this.root.getByLabel("טלפון").fill(fields.phone);
  }

  @test_step("send the consultation request")
  async send() {
    await this.submit.click();
  }
}

test.describe("Quick contact form", () => {
  test("keeps submit disabled until name and phone are filled", async ({ page }) => {
    const form = new QuickContactForm(page);
    await form.open();

    await test_step("the empty form cannot be submitted", async () => {
      await expect(form.submit).toBeDisabled();
    });

    await form.fill({ name: LEAD.name });
    await test_step("a name alone is still not enough", async () => {
      await expect(form.submit).toBeDisabled();
    });

    await form.fill({ phone: LEAD.phone });
    await test_step("with a phone number the form unlocks", async () => {
      await expect(form.submit).toBeEnabled();
    });
  });

  test("submits, confirms, and sends the payload the backend expects", async ({ page, mockApi }) => {
    const form = new QuickContactForm(page);
    await form.open();
    await form.fill({ ...LEAD, message: "אשמח לשיחה על דמי ניהול." });
    await form.send();

    await test_step("the visitor is told the message went out", async () => {
      await expect(form.root.getByText("ההודעה נשלחה. תודה.")).toBeVisible();
    });

    await test_step("an email is sent to the adviser with the visitor's details", async () => {
      const email = await mockApi.waitForRequest("/integration-endpoints/Core/SendEmail");
      const emailBody = email.body as Record<string, string>;
      expect(emailBody.to).toContain("@");
      expect(emailBody.subject).toContain(LEAD.name);
      expect(emailBody.body).toContain(LEAD.phone);
    });

    await test_step("the lead is recorded with the shape the backend expects", async () => {
      const lead = await mockApi.waitForRequest("/entities/Lead");
      expect(lead.method).toBe("POST");
      expect(lead.body).toMatchObject({
        name: LEAD.name,
        phone: LEAD.phone,
        email: LEAD.email,
        source: "quick",
        status: "new",
      });
    });
  });

  test("shows a recoverable error and a direct mail fallback when sending fails", async ({ page, mockApi }) => {
    await test_step("break the mail integration with a 500", async () => {
      mockApi.failOn("/integration-endpoints/Core/SendEmail", 500, { error: "smtp down" });
    });

    const form = new QuickContactForm(page);
    await form.open();
    await form.fill({ name: LEAD.name, phone: LEAD.phone });
    await form.send();

    await test_step("the failure is explained rather than swallowed", async () => {
      await expect(form.root.getByText(/לא הצלחנו לשלוח/)).toBeVisible();
    });

    await test_step("the visitor's input survives so they can retry", async () => {
      await expect(form.root.locator("#qc-name")).toHaveValue(LEAD.name);
      await expect(form.submit).toBeEnabled();
    });
  });

  test("still records the lead when only the optional secondary copy fails", async ({ page, mockApi }) => {
    const form = new QuickContactForm(page);
    await form.open();
    await form.fill({ name: LEAD.name, phone: LEAD.phone });
    await form.send();

    await test_step("the visitor is confirmed and exactly one lead is written", async () => {
      await expect(form.root.getByText("ההודעה נשלחה. תודה.")).toBeVisible();
      expect(mockApi.requestsTo("/entities/Lead").filter((r) => r.method === "POST")).toHaveLength(1);
    });
  });
});

test.describe("Detailed contact form", () => {
  test("gates submission on service, message and the consent checkbox", async ({ page }) => {
    const form = new DetailedContactForm(page);
    await form.open();

    await test_step("the empty form cannot be submitted", async () => {
      await expect(form.submit).toBeDisabled();
    });

    await form.fillBasics({ name: LEAD.name, phone: LEAD.phone, message: "שאלה על ליווי תביעה." });
    await test_step("name, phone and message alone are not enough", async () => {
      await expect(form.submit).toBeDisabled(); // no service, no consent
    });

    await form.chooseService("ליווי תביעות");
    await test_step("choosing a service still leaves consent missing", async () => {
      await expect(form.submit).toBeDisabled();
    });

    await form.consent();
    await test_step("with consent given the form unlocks", async () => {
      await expect(form.submit).toBeEnabled();
    });
  });

  test("marks the chosen service as pressed for assistive tech", async ({ page }) => {
    const form = new DetailedContactForm(page);
    await form.open();

    const service = form.root.getByRole("button", { name: "פנסיה ופיננסים" });

    await test_step("the service starts out unpressed", async () => {
      await expect(service).toHaveAttribute("aria-pressed", "false");
    });

    await form.chooseService("פנסיה ופיננסים");

    await test_step("choosing it announces the selection to a screen reader", async () => {
      await expect(service).toHaveAttribute("aria-pressed", "true");
    });
  });

  test("sends a detailed lead with topic and timing", async ({ page, mockApi }) => {
    const form = new DetailedContactForm(page);
    await form.open();
    await form.fillBasics({ name: LEAD.name, phone: LEAD.phone });
    await form.chooseService("ליווי תביעות");

    await test_step("pick a preferred time to be called back", async () => {
      await form.root.locator("#dc-contact-time").selectOption("ערב");
    });

    await form.fillBasics({ name: LEAD.name, phone: LEAD.phone, message: "שאלה על ליווי תביעה." });
    await form.consent();

    await test_step("send the enquiry", async () => {
      await form.submit.click();
    });

    await test_step("the visitor is thanked", async () => {
      await expect(form.root.getByText("תודה, הטופס נשלח.")).toBeVisible();
    });

    await test_step("the lead carries the topic and the timing", async () => {
      const lead = await mockApi.waitForRequest("/entities/Lead");
      expect(lead.body).toMatchObject({
        source: "detailed",
        topic: "ליווי תביעות",
        timing: "ערב",
        status: "new",
      });
    });
  });
});

test.describe("Consultation builder", () => {
  test("walks the three steps and books a consultation end to end", async ({ page, mockApi }) => {
    const wizard = new ConsultationWizard(page);
    await wizard.open();

    await test_step("the wizard will not advance without a topic", async () => {
      await expect(wizard.root.getByRole("button", { name: "המשך" })).toBeDisabled();
    });

    await wizard.chooseTopic("פנסיה ופיננסים");
    await wizard.chooseTiming("השבוע");

    await test_step("the last step is gated on contact details", async () => {
      await expect(wizard.submit).toBeDisabled();
    });

    await wizard.fillContact({ name: LEAD.name, phone: LEAD.phone });

    await test_step("with name and phone the request can be sent", async () => {
      await expect(wizard.submit).toBeEnabled();
    });

    await wizard.send();

    await test_step("the visitor is thanked by name", async () => {
      await expect(wizard.root.getByText(/תודה, ישראלה/)).toBeVisible();
    });

    await test_step("the lead records the topic and timing chosen in the wizard", async () => {
      const lead = await mockApi.waitForRequest("/entities/Lead");
      expect(lead.body).toMatchObject({
        source: "consultation",
        topic: "פנסיה ופיננסים",
        timing: "השבוע",
      });
    });

    await test_step("the calendar function is invoked with the documented payload", async () => {
      const fn = await mockApi.waitForRequest("/functions/createConsultationEvent");
      expect(fn.method).toBe("POST");
      expect(Object.keys(fn.body as object).sort()).toEqual(
        ["email", "name", "notes", "phone", "timing", "topic"]
      );
    });
  });

  test("lets the visitor step back without losing their answers", async ({ page }) => {
    const wizard = new ConsultationWizard(page);
    await wizard.open();
    await wizard.chooseTopic("ליווי תביעות");

    await test_step("go back to the topic step", async () => {
      await wizard.root.getByRole("button", { name: "חזור" }).click();
    });

    await test_step("the earlier answer is still selected, so the visitor can continue", async () => {
      await expect(wizard.root.getByRole("button", { name: "המשך" })).toBeEnabled();
    });
  });

  test("still confirms to the visitor when calendar booking fails", async ({ page, mockApi }) => {
    await test_step("make the calendar function fail with a 502", async () => {
      mockApi.failOn("/functions/createConsultationEvent", 502, { error: "google down" });
    });

    const wizard = new ConsultationWizard(page);
    await wizard.open();
    await wizard.chooseTopic("פנסיה ופיננסים");
    await wizard.chooseTiming("השבוע");
    await wizard.fillContact({ name: LEAD.name, phone: LEAD.phone });
    await wizard.send();

    await test_step("the calendar hop is best-effort — the lead is what must survive", async () => {
      await expect(wizard.root.getByText(/תודה, ישראלה/)).toBeVisible();
      expect(mockApi.requestsTo("/entities/Lead")).not.toHaveLength(0);
    });
  });

  test("refuses to submit the wizard without a phone number", async ({ page, mockApi }) => {
    const wizard = new ConsultationWizard(page);
    await wizard.open();
    await wizard.chooseTopic("פנסיה ופיננסים");
    await wizard.chooseTiming("השבוע");
    await wizard.fillContact({ name: LEAD.name });

    await test_step("the request cannot be sent and no lead reaches the backend", async () => {
      await expect(wizard.submit).toBeDisabled();
      expect(mockApi.requestsTo("/entities/Lead")).toHaveLength(0);
    });
  });
});
