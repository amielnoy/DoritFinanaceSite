import { expect, gotoApp, test, test_step } from "../fixtures/app";

/**
 * The claim form is the highest-stakes surface on the site: someone uses it
 * right after an insurance event, at their least patient. It previously had no
 * end-to-end coverage at all — its critical labelling bug was caught only by a
 * page-level accessibility scan.
 */
class ClaimFormPage {
  readonly root = this.page.locator("#claim-form, form").last();

  constructor(private readonly page: import("@playwright/test").Page) {}

  async open() {
    await test_step("open the claims page and reach the report form", async () => {
      await gotoApp(this.page, "/claims");
      await expect(this.page.getByRole("button", { name: "שליחת דיווח" })).toBeVisible();
    });
  }

  field(label: string) {
    return this.page.getByLabel(label);
  }

  get submit() {
    return this.page.getByRole("button", { name: "שליחת דיווח", exact: true });
  }

  async fillMinimum(name: string, phone: string) {
    await this.field("שם מלא *").fill(name);
    await this.field("טלפון *").fill(phone);
  }
}

test.describe("Claim submission", () => {
  const REPORTER = { name: "ישראלה ישראלי", phone: "050-1234567", email: "a@b.co" };

  test("every control on the form has an accessible name", async ({ page }) => {
    const form = new ClaimFormPage(page);
    await form.open();

    await test_step("each labelled control is reachable by its label", async () => {
      for (const label of [
        "שם מלא *",
        "טלפון *",
        "אימייל (לא חובה)",
        "מספר פוליסה (לא חובה)",
        "סוג אירוע",
        "תאריך האירוע",
        "תיאור האירוע",
      ]) {
        await expect(form.field(label), `no control labelled ${label}`).toBeVisible();
      }
    });

    await test_step("no control is left unnamed", async () => {
      const unnamed = await page.locator("input, select, textarea").evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLInputElement).type !== "hidden")
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .filter((el) => {
            const id = el.getAttribute("id");
            return !(
              (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
              el.closest("label") ||
              el.getAttribute("aria-label") ||
              el.getAttribute("aria-labelledby")
            );
          })
          .map((el) => `${el.tagName.toLowerCase()}#${el.id || "(no id)"}`)
      );
      expect(unnamed).toEqual([]);
    });
  });

  test("refuses to submit without a name and phone", async ({ page, mockApi }) => {
    const form = new ClaimFormPage(page);
    await form.open();

    await test_step("submit is disabled until the required fields are present", async () => {
      await expect(form.submit).toBeDisabled();

      await form.field("שם מלא *").fill(REPORTER.name);
      await expect(form.submit, "a name alone must not be enough").toBeDisabled();

      await form.field("טלפון *").fill(REPORTER.phone);
      await expect(form.submit).toBeEnabled();
    });

    await test_step("nothing was sent along the way", async () => {
      expect(mockApi.requestsTo("/functions/v1/submit-claim")).toHaveLength(0);
    });
  });

  test("reports an event and confirms to the visitor", async ({ page, mockApi }) => {
    const form = new ClaimFormPage(page);
    await form.open();

    await test_step("fill in the report", async () => {
      await form.fillMinimum(REPORTER.name, REPORTER.phone);
      await form.field("אימייל (לא חובה)").fill(REPORTER.email);
      await form.field("מספר פוליסה (לא חובה)").fill("POL-99123");
      await form.field("סוג אירוע").selectOption("אובדן כושר עבודה");
      await form.field("תיאור האירוע").fill("נפילה במדרגות, טופל בבית חולים.");
    });

    await test_step("submit it", async () => form.submit.click());

    const req = await test_step("the report reaches the backend function", () =>
      mockApi.waitForRequest("/functions/v1/submit-claim")
    );

    await test_step("it carries what the visitor entered", async () => {
      expect(req.method).toBe("POST");
      expect(req.body).toMatchObject({
        name: REPORTER.name,
        phone: REPORTER.phone,
        email: REPORTER.email,
        policyNumber: "POL-99123",
        claimType: "אובדן כושר עבודה",
      });
    });

    await test_step("the visitor is told it was received", async () => {
      await expect(page.getByRole("button", { name: /שליחת דיווח נוסף/ })).toBeVisible();
    });
  });

  test("keeps the report on screen and offers a fallback when the backend fails", async ({ page, mockApi }) => {
    mockApi.failOn("/functions/v1/submit-claim", 500, { error: "down", rid: "e2e-rid" });
    const form = new ClaimFormPage(page);
    await form.open();

    await test_step("fill and submit", async () => {
      await form.fillMinimum(REPORTER.name, REPORTER.phone);
      await form.submit.click();
    });

    await test_step("the failure names the fallback address from config", async () => {
      const failure = page.getByText(/לא הצלחנו לשלוח את הדיווח/);
      await expect(failure).toBeVisible();
      // The address is interpolated from CONTACT.email, not written into the copy.
      await expect(failure).toContainText("dorit@govari-fin.co.il");
    });

    await test_step("what they typed is still there", async () => {
      await expect(form.field("שם מלא *")).toHaveValue(REPORTER.name);
    });
  });

  test("does not file two reports on a double click", async ({ page, mockApi }) => {
    const form = new ClaimFormPage(page);
    await form.open();

    await test_step("fill and double-click submit", async () => {
      await form.fillMinimum(REPORTER.name, REPORTER.phone);
      await form.submit.dblclick();
    });

    await test_step("exactly one report was filed", async () => {
      await mockApi.waitForRequest("/functions/v1/submit-claim");
      expect(mockApi.requestsTo("/functions/v1/submit-claim")).toHaveLength(1);
    });
  });

  // D-02, manual test 2026-10-14: picking a file uploaded it at once, with no
  // type or size check, before the visitor had decided to report anything.
  test("keeps documents in the browser until the report is sent, and turns away the wrong ones", async ({ page, mockApi }) => {
    const form = new ClaimFormPage(page);
    await form.open();
    const picker = page.getByLabel("לחצו לבחירת קבצים, או גררו לכאן");

    await test_step("pick a program and a PDF", async () => {
      await picker.setInputFiles([
        { name: "setup.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") },
        { name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") },
      ]);
    });

    await test_step("the program is named and left out; the PDF is listed; nothing is uploaded", async () => {
      await expect(page.getByText(/"setup\.exe" — ניתן לצרף PDF או תמונה/)).toBeVisible();
      await expect(page.getByText("receipt.pdf")).toBeVisible();
      await expect(page.getByText("setup.exe", { exact: true })).toHaveCount(0);
      expect(mockApi.requestsTo("/storage/v1/object/claim-documents/")).toHaveLength(0);
    });

    await test_step("send: the PDF is uploaded, then the report carries it", async () => {
      await form.fillMinimum(REPORTER.name, REPORTER.phone);
      await form.submit.click();
      const report = await mockApi.waitForRequest("/functions/v1/submit-claim");
      expect(mockApi.requestsTo("/storage/v1/object/claim-documents/")).toHaveLength(1);
      const documents = (report.body as { documents: string[] }).documents;
      expect(documents).toHaveLength(1);
      // The object's path in the private bucket, never a link (SupabaseUploadService).
      expect(documents[0]).toMatch(/^storage:claim-documents\/.+receipt\.pdf$/);
    });
  });
});
