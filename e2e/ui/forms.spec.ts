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

// `DetailedContactForm` and `ConsultationBuilder` used to be exercised here.
// Both were removed from the site: the home page offered five separate ways
// to send the same name and phone number, and these were two of them. The
// interview agent in #start does this work now, with the short form beside it
// for anyone who would rather not chat. See src/pages/Home.tsx.

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

    const submission = await test_step(
      "the browser hands the lead to the submitLead backend function",
      async () => mockApi.waitForRequest("/functions/submitLead")
    );

    await test_step("it carries the shape the function destructures", async () => {
      expect(submission.method).toBe("POST");
      // Email delivery, the Lead write and `status` all live in the backend
      // now, so the browser sends only what the visitor typed.
      expect(submission.body).toMatchObject({
        name: LEAD.name,
        phone: LEAD.phone,
        email: LEAD.email,
        source: "quick",
      });
    });
  });

  test("shows a recoverable error and a direct mail fallback when sending fails", async ({ page, mockApi }) => {
    await test_step("break the mail integration with a 500", async () => {
      mockApi.failOn("/functions/submitLead", 500, { error: "backend down" });
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
      expect(mockApi.requestsTo("/functions/submitLead").filter((r) => r.method === "POST")).toHaveLength(1);
    });
  });
});
