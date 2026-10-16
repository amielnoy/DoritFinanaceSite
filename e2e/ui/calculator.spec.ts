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

    // D-15, manual test 2026-10-14: 100% fees, 100 years and ₪1,000,000 a
    // month were all priced. Leaving a field brings it to its ceiling, so the
    // result is for the figure on screen.
    await test_step("leaving each field brings an absurd value down to the calculator's ceiling", async () => {
      await field(page, "הפקדה חודשית (₪)").fill("1000000");
      await field(page, "דמי ניהול בהפקדה (%)").fill("100");
      await field(page, "דמי ניהול שוטפים (% שנתי)").fill("100");
      await field(page, "שנות חיסכון").focus();
      await expect(field(page, "הפקדה חודשית (₪)")).toHaveValue("50000");
      await expect(field(page, "דמי ניהול בהפקדה (%)")).toHaveValue("15");
      await expect(field(page, "דמי ניהול שוטפים (% שנתי)")).toHaveValue("3");
      await expect(field(page, "שנות חיסכון")).toHaveAttribute("max", "50");
      await field(page, "הפקדה חודשית (₪)").focus();
      await expect(field(page, "שנות חיסכון")).toHaveValue("50");
      await expect(field(page, "תשואה שנתית צפויה (%)")).toHaveValue("15");
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

/** The GA4 events the page queued (the inline gtag stub; the real tag is blocked by the fixture). */
const queued = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? [])
      .map((entry) => Array.from(entry))
      .filter((args) => args[0] === "event")
      .map((args) => ({ name: String(args[1]), params: (args[2] ?? {}) as Record<string, string> })),
  );

const LEAD_HEADING = "רוצים שדורית תבדוק את הנתונים האמיתיים שלכם?";
const leadBox = (page: import("@playwright/test").Page, section: string) =>
  page.locator(`${section} [data-track-location="calculator"]`);
const waText = async (box: import("@playwright/test").Locator) =>
  decodeURIComponent(((await box.getByRole("link", { name: /וואטסאפ/ }).getAttribute("href")) ?? "").split("?text=")[1] ?? "");

/** Answers the self-check: single, employed, a mortgage, no health risk. */
async function completeAssessment(page: import("@playwright/test").Page) {
  const section = page.locator("#assessment");
  await section.scrollIntoViewIfNeeded();
  for (const [question, answer] of [
    ["באיזה שלב חיים את/ה?", "רווק/ה"],
    ["איך את/ה עובד/ת?", "שכיר/ה"],
    ["יש משכנתא או הלוואות משמעותיות?", "כן"],
    ["יש מחלות כרוניות או סיכון משפחתי?", "לא / לא יודע/ת"],
  ]) {
    await expect(section.getByRole("heading", { name: question })).toBeVisible();
    await section.getByRole("button", { name: answer, exact: true }).click();
  }
  await expect(section.getByText("התוצאה שלך")).toBeVisible();
}

test.describe("Calculator → lead: the box after a result", () => {
  test("the fee calculator offers Dorit's check on WhatsApp, its result written in, and counts it once", async ({ page }) => {
    await openCalculator(page);
    const box = leadBox(page, "#fee-calculator");

    await test_step("the box sits under the result, beside the calculator's own disclaimer", async () => {
      await expect(box.getByRole("heading", { name: LEAD_HEADING })).toBeVisible();
      await expect(box.getByText(/הערכה כללית בלבד ואינה ייעוץ או המלצה/)).toBeVisible();
      await expect(page.locator("#fee-calculator").getByText("הערכה כללית בלבד — אינה מחליפה ייעוץ אישי.")).toBeVisible();
      const href = await box.getByRole("link", { name: /וואטסאפ/ }).getAttribute("href");
      expect(href).toMatch(/^https:\/\/wa\.me\/972508311776\?text=/);
      expect(await waText(box)).toContain("לאורך 25 שנות חיסכון");
    });

    await test_step("the defaults nobody touched send no calculator_result", async () => {
      await page.waitForTimeout(2_000);
      expect((await queued(page)).filter((e) => e.name === "calculator_result")).toEqual([]);
    });

    await test_step("typing a deposit sends one calculator_result once it settles, with the tool's name and no figure", async () => {
      await field(page, "הפקדה חודשית (₪)").pressSequentially("3", { delay: 50 });
      await field(page, "הפקדה חודשית (₪)").fill("3000");
      await expect
        .poll(async () => (await queued(page)).filter((e) => e.name === "calculator_result").length, { timeout: 6_000 })
        .toBe(1);
      await page.waitForTimeout(2_000);
      const results = (await queued(page)).filter((e) => e.name === "calculator_result");
      expect(results).toHaveLength(1);
      expect(results[0].params.tool).toBe("fee_calculator");
      for (const e of await queued(page)) expect(JSON.stringify(e.params)).not.toMatch(/\d/);
      expect(await waText(box)).toMatch(/בהפקדה חודשית של .*3,000/);
    });

    await test_step("the button is click_whatsapp from location calculator", async () => {
      // Keep the page: the tracker listens in the capture phase, before this.
      await page.evaluate(() => window.addEventListener("click", (e) => e.preventDefault()));
      await box.getByRole("link", { name: /וואטסאפ/ }).click();
      expect(await queued(page)).toContainEqual(
        expect.objectContaining({ name: "click_whatsapp", params: expect.objectContaining({ location: "calculator" }) }),
      );
    });
  });

  test("the insurance self-check ends with the same box, its result in the message, counted once", async ({ page }) => {
    await gotoApp(page, "/tools");

    await test_step("no box before the last answer", async () => {
      await expect(leadBox(page, "#assessment")).toHaveCount(0);
    });

    await test_step("answer the four questions", () => completeAssessment(page));

    const box = leadBox(page, "#assessment");
    await test_step("the box names the kinds of insurance the check showed, and both disclaimers stay", async () => {
      await expect(box.getByRole("heading", { name: LEAD_HEADING })).toBeVisible();
      expect(await waText(box)).toMatch(/סוגי ביטוח לבחון: .*ביטוח חיים/);
      await expect(page.locator("#assessment").getByText(/ההערכה כאן היא כללית בלבד/)).toBeVisible();
      await expect(page.locator("#assessment").getByText(/אינו מהווה ייעוץ פיננסי/)).toBeVisible();
    });

    await test_step("one calculator_result, tool insurance_assessment", async () => {
      const results = (await queued(page)).filter((e) => e.name === "calculator_result");
      expect(results.map((e) => e.params.tool)).toEqual(["insurance_assessment"]);
    });
  });
});

test.describe("Calculator → lead on a 375px phone", { tag: "@mobile-only" }, () => {
  test("the box sits clear of the 64px sticky-bar band, with no sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoApp(page, "/tools");
    await completeAssessment(page);
    // The sticky bar is on the home page and the blog, not on /tools today. The
    // box must clear the 64px band at the bottom of the screen either way, so
    // the bar's own top is used when it is there and the band's otherwise.
    const bar = page.locator("div.md\\:hidden.fixed.bottom-0");
    const barTop = async () =>
      (await bar.count()) > 0 && (await bar.isVisible()) ? (await bar.boundingBox())!.y : 667 - 64;

    for (const section of ["#fee-calculator", "#assessment"]) {
      await test_step(`${section}: the box, centred, ends above the band and its button is not covered`, async () => {
        const box = leadBox(page, section);
        expect(await box.evaluate((el) => getComputedStyle(el).position)).toBe("static");
        // `instant`: the page scrolls smoothly, and a box read mid-glide is not where it lands.
        await box.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
        await expect(box).toBeInViewport({ ratio: 1 });
        const b = (await box.boundingBox())!;
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y + b.height).toBeLessThanOrEqual(await barTop());
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(375);
        const link = box.getByRole("link", { name: /וואטסאפ/ });
        const l = (await link.boundingBox())!;
        const hit = await page.evaluate(
          ([x, y]) => document.elementFromPoint(x, y)?.closest("a")?.getAttribute("href") ?? "",
          [l.x + l.width / 2, l.y + l.height / 2],
        );
        expect(hit).toMatch(/^https:\/\/wa\.me\//);
      });
    }

    await test_step("no sideways scroll", async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    });
  });
});
