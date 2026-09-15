import { collectPageErrors, expect, gotoApp, test, test_step } from "../fixtures/app";

/** Reads the four result cards as raw numbers (strips ₪, NBSP and separators). */
async function readResults(page: import("@playwright/test").Page) {
  const section = page.locator("#fee-calculator");
  const values = await section.locator("p.font-heading").allInnerTexts();
  return values.map((v) => Number(v.replace(/[^\d-]/g, "")));
}

const field = (page: import("@playwright/test").Page, label: string) =>
  page.locator("#fee-calculator").getByLabel(label);

/** Every case starts the same way: land on the home page, scroll to the tool. */
const openCalculator = (page: import("@playwright/test").Page) =>
  test_step("open the home page and scroll to the fee calculator", async () => {
    await gotoApp(page, "/tools");
    await page.locator("#fee-calculator").scrollIntoViewIfNeeded();
  });

test.describe("Pension fee calculator — sanity", () => {
  test("shows the default scenario with a plausible result set", async ({ page }) => {
    await openCalculator(page);

    const [deposited, balance, depositFees, annualFees] = await test_step(
      "read the four result cards of the default scenario",
      () => readResults(page)
    );

    await test_step("the deposits and the deposit fee match the default inputs", async () => {
      expect(deposited).toBe(600_000); // 25y × 12 × ₪2,000
      expect(depositFees).toBe(12_000); // 2% of deposits
    });

    await test_step("the projected balance beats the deposits and fees accrue", async () => {
      expect(balance).toBeGreaterThan(deposited);
      expect(annualFees).toBeGreaterThan(0);
    });
  });

  test("recomputes live when the saver changes an input", async ({ page }) => {
    await openCalculator(page);

    const before = await test_step("record the results before touching anything", () =>
      readResults(page)
    );

    await test_step("double the monthly deposit to ₪4,000", async () => {
      await field(page, "הפקדה חודשית (₪)").fill("4000");
    });

    await test_step("the totals recompute without a page reload", async () => {
      await expect
        .poll(async () => (await readResults(page))[0])
        .toBe(1_200_000);

      const after = await readResults(page);
      expect(after[1]).toBeGreaterThan(before[1]); // bigger balance
    });
  });

  test("higher management fees shrink the projected balance", async ({ page }) => {
    await openCalculator(page);

    const cheap = await test_step("record the balance at the default fee", async () =>
      (await readResults(page))[1]
    );

    await test_step("raise the ongoing management fee to 1.5% a year", async () => {
      await field(page, "דמי ניהול שוטפים (% שנתי)").fill("1.5");
    });

    await test_step("the projected balance drops", async () => {
      await expect.poll(async () => (await readResults(page))[1]).toBeLessThan(cheap);
    });
  });

  test("never renders NaN or ₪NaN when fields are cleared", async ({ page }) => {
    const { errors } = collectPageErrors(page);
    await openCalculator(page);
    const section = page.locator("#fee-calculator");

    await test_step("clear every input the saver can edit", async () => {
      for (const label of [
        "הפקדה חודשית (₪)",
        "שנות חיסכון",
        "דמי ניהול בהפקדה (%)",
        "דמי ניהול שוטפים (% שנתי)",
        "תשואה שנתית צפויה (%)",
      ]) {
        await field(page, label).fill("");
      }
    });

    await test_step("the results stay readable — no NaN, no Infinity, no errors", async () => {
      await expect(section).not.toContainText("NaN");
      await expect(section).not.toContainText("Infinity");
      expect(errors, errors.join("\n")).toEqual([]);
    });
  });

  test("shrugs off absurd input instead of hanging the tab", async ({ page }) => {
    await openCalculator(page);

    await test_step("enter 120 saving years at a 99% annual return", async () => {
      await field(page, "שנות חיסכון").fill("120");
      await field(page, "תשואה שנתית צפויה (%)").fill("99");
    });

    await test_step("the results are still numbers and the page is still interactive", async () => {
      await expect(page.locator("#fee-calculator")).not.toContainText("NaN");
      await expect(field(page, "שנות חיסכון")).toBeEditable();
    });
  });

  test("its CTA points at the contact form", async ({ page }) => {
    await test_step("open the home page", async () => {
      await gotoApp(page, "/tools");
    });

    await test_step("the calculator's CTA leads to the quick contact form", async () => {
      const cta = page.locator('#fee-calculator a[href="/#start"]');
      await expect(cta).toBeVisible();
    });
  });
});
