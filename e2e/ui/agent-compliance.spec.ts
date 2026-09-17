import { expect, gotoApp, test, test_step } from "../fixtures/app";

/**
 * The compliance behaviour of the on-site agents, checked in a real browser.
 *
 * The prompts in `base44/agents/` carry the same rules, but a prompt is a
 * request to a model and this is a gate: a visitor must not be able to send a
 * first message before accepting the notice, and must be able to reach a person
 * without the model's cooperation. Those two are enforced by the shell, so they
 * are testable — and this is where they are tested.
 */

const INTERVIEW = "#start";

test.describe("Agent chat — regulatory shell", () => {
  test("a visitor cannot type before accepting the consent notice", async ({ page, mockApi }) => {
    await test_step("open the home page and find the interview agent", async () => {
      await gotoApp(page, "/");
    });

    const section = page.locator(INTERVIEW);
    const box = section.getByLabel("הודעה לסוכן ההיכרות");

    await test_step("the message box is disabled and says why", async () => {
      await expect(box).toBeDisabled();
      await expect(box).toHaveAttribute("placeholder", "יש לאשר את ההסכמה כדי להתחיל");
    });

    await test_step("no conversation was opened with the backend", async () => {
      expect(mockApi.requestsTo("/agents/")).toHaveLength(0);
    });

    await test_step("accepting the notice unlocks the box", async () => {
      await section.getByRole("checkbox").check();
      await section.getByRole("button", { name: "התחלת השיחה" }).click();
      await expect(box).toBeEnabled();
    });
  });

  test("the notice discloses the bot, the licence and the data collected", async ({ page }) => {
    await gotoApp(page, "/");
    const section = page.locator(INTERVIEW);

    await test_step("it says this is not a person and not a licence holder", async () => {
      await expect(section.getByText(/עוזר אוטומטי/).first()).toBeVisible();
    });

    await test_step("it discloses the licence number and the affiliation", async () => {
      await expect(section.getByText(/L-00107009/)).toBeVisible();
      await expect(section.getByText(/שיווק פנסיוני ולא ייעוץ פנסיוני אובייקטיבי/)).toBeVisible();
    });

    await test_step("it names what may not be typed into the chat", async () => {
      await expect(section.getByText(/אין למסור בצ׳אט תעודת זהות/)).toBeVisible();
    });

    await test_step("it links to the full privacy policy", async () => {
      await expect(section.getByRole("link", { name: "מדיניות הפרטיות המלאה" })).toHaveAttribute(
        "href",
        "/privacy"
      );
    });
  });

  test("the fence is published beside the interview agent", async ({ page }) => {
    await gotoApp(page, "/");
    const section = page.locator(INTERVIEW);

    await expect(
      section.getByText(
        "בינה מלאכותית שמשרתת את הלקוח עד לרגע שבו נדרש בעל רישיון — ואז מעבירה לסוכן."
      )
    ).toBeVisible();
    await expect(section.getByText("כללי הגדר")).toBeVisible();
    await expect(section.getByText("מה הוא לא עושה")).toBeVisible();
    await expect(section.getByText("מתי עובר לאדם")).toBeVisible();
  });

  test("a standing disclaimer sits under every message box", async ({ page }) => {
    await gotoApp(page, "/");
    for (const id of ["#start"]) {
      await expect(
        page.locator(id).getByText(/אינו ייעוץ, שיווק פנסיוני או המלצה אישית/)
      ).toBeVisible();
    }
  });

  test("the route to a person works without the model, and before consent", async ({
    page,
    mockApi,
  }) => {
    await gotoApp(page, "/");
    const section = page.locator(INTERVIEW);

    await test_step("the handoff control is present from the first frame", async () => {
      await expect(section.getByRole("button", { name: "מעבר לטיפול אנושי" })).toBeVisible();
    });

    await test_step("pressing it escalates to the backend", async () => {
      await section.getByRole("button", { name: "מעבר לטיפול אנושי" }).click();
      const req = await mockApi.waitForRequest("escalateToHuman");
      expect(req.method).toBe("POST");
    });

    await test_step("the visitor is given direct channels either way", async () => {
      await expect(section.getByRole("link", { name: /050-831-1776/ })).toBeVisible();
      // Exact: the section also carries an "עדיף לי בוואטסאפ" alternative, and
      // Playwright matches accessible names by substring unless told otherwise.
      await expect(section.getByRole("link", { name: "וואטסאפ", exact: true })).toBeVisible();
    });
  });
});

/**
 * The support chat, which is the same shell around a different promise.
 *
 * The interview's notice tells the visitor a name and a phone number are being
 * collected. The support chat collects neither and keeps a record of the
 * conversation instead, so it shows its own notice — and the failure worth
 * catching is the quiet one: the wrong notice rendering here would still look
 * entirely correct, because it is a real consent notice for a different chat.
 */
test.describe("Support chat — the open question", () => {
  const SUPPORT = "#support-chat";

  test("a visitor cannot type before accepting the notice", async ({ page, mockApi }) => {
    await gotoApp(page, "/faq");
    const section = page.locator(SUPPORT);
    const box = section.getByLabel("הודעה לסוכן התמיכה");

    await test_step("the message box is disabled until the notice is accepted", async () => {
      await expect(box).toBeDisabled();
      expect(mockApi.requestsTo("/agents/")).toHaveLength(0);
    });

    await test_step("accepting it unlocks the box", async () => {
      await section.getByRole("checkbox").check();
      await section.getByRole("button", { name: "התחלת השיחה" }).click();
      await expect(box).toBeEnabled();
    });
  });

  test("the notice describes this chat and not the interview", async ({ page }) => {
    await gotoApp(page, "/faq");
    const section = page.locator(SUPPORT);

    await test_step("it says the conversation itself is kept, and why", async () => {
      // The clause naming the purpose, which only the consent point carries —
      // the note beside the chat says the same thing in shorter words.
      await expect(section.getByText(/כדי לדעת מה נשאל ולשפר את המענה/)).toBeVisible();
    });

    await test_step("it does not promise to collect a name and a phone number", async () => {
      // The interview's third point. Here it would describe processing that
      // does not happen — and consent to processing that does not happen is
      // not consent to the processing that does.
      await expect(section.getByText(/נאספים שם וטלפון בלבד/)).toHaveCount(0);
    });

    await test_step("it still carries the licence and the affiliation", async () => {
      await expect(section.getByText(/L-00107009/)).toBeVisible();
      await expect(section.getByText(/שיווק פנסיוני ולא ייעוץ פנסיוני אובייקטיבי/)).toBeVisible();
    });
  });

  test("the route to a person is here too", async ({ page, mockApi }) => {
    await gotoApp(page, "/faq");
    const section = page.locator(SUPPORT);

    await section.getByRole("button", { name: "מעבר לטיפול אנושי" }).click();
    const req = await mockApi.waitForRequest("escalateToHuman");
    expect(req.method).toBe("POST");
  });
});
