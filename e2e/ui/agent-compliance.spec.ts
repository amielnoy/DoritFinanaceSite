import type { Locator } from "@playwright/test";
import { expect, gotoApp, test, test_step } from "../fixtures/app";

/**
 * The handoff form, addressed by its accessible name.
 *
 * The interview section also carries the quick-contact form, so a bare
 * `getByLabel("טלפון")` matches two fields and Playwright refuses in strict
 * mode. Naming the form is the fix on both sides: a screen reader gets a
 * landmark, and a test gets an unambiguous scope.
 */
const handoffForm = (section: Locator) =>
  section.getByRole("form", { name: "מעבר לטיפול אנושי" });

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

  /**
   * The consent gate is read by scrolling; it is not acted on by scrolling.
   *
   * It used to be one column — four paragraphs of regulatory disclosure, a
   * privacy link, a checkbox and a button — so on a phone the checkbox sat well
   * below the fold and starting a conversation began with a long scroll past
   * text most people will not read twice.
   *
   * Collapsing the notice would have been the easy fix and the wrong one: the
   * checkbox says "כמפורט למעלה", which stops being true the moment the detail
   * is behind a toggle. So the notice still scrolls, in full, and the action
   * sits in a footer that does not.
   */
  test("the consent checkbox is reachable without scrolling", async ({ page }) => {
    await gotoApp(page, "/");
    const section = page.locator(INTERVIEW);
    const box = section.getByRole("checkbox");
    const start = section.getByRole("button", { name: /התחלת השיחה/ });

    await test_step("the action is on screen whenever the notice is", async () => {
      // Reaching the chat is one page scroll and always was — `#start` carries
      // the heading, the boundary card and the contact alternatives above it.
      // What this pins is what happens *after* that: bring the notice into
      // view, and the box and the button are there with it. No second scroll
      // through four paragraphs of disclosure to reach the thing you click.
      await section.getByText(/לפני שמתחילים/).scrollIntoViewIfNeeded();
      await expect(box, "the checkbox is below the fold of its own panel").toBeInViewport();
      await expect(start, "the start button is below the fold of its own panel").toBeInViewport();
    });

    await test_step("and the notice itself is still all there", async () => {
      // The point of the change: nothing was hidden to achieve the above.
      await expect(section.getByText(/רישיון סוכן/)).toBeAttached();
      await expect(section.getByText(/אין למסור בצ׳אט תעודת זהות/)).toBeAttached();
      await expect(section.getByRole("link", { name: /מדיניות הפרטיות/ })).toBeAttached();
    });

    await test_step("the box is a comfortable target", async () => {
      // A 16px checkbox on a phone is a miss waiting to happen; the label is
      // the target, so the whole row counts.
      // The label the box lives in, reached from the box itself — `has:` with a
      // section-scoped locator matches the handoff form's labels too.
      const label = box.locator("xpath=ancestor::label[1]");
      const size = await label.boundingBox();
      expect(size!.height, "the consent row is too small to hit").toBeGreaterThanOrEqual(44);
    });
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

    await test_step("pressing it asks who to call back", async () => {
      await section.getByRole("button", { name: "מעבר לטיפול אנושי" }).click();
      await expect(section.getByText(/איך קוראים לכם, ולאן להתקשר/)).toBeVisible();
    });

    await test_step("and the details reach the backend with the request", async () => {
      // The whole point. דורית received three handoffs in one morning reading
      // `שם: לא נמסר · טלפון: לא נמסר`, which she could do nothing with (A-55).
      await handoffForm(section).getByLabel("שם").fill("רונית אבני");
      await handoffForm(section).getByLabel("טלפון").fill("052-7654321");
      await section.getByRole("button", { name: "שלחו לדורית" }).click();
      const req = await mockApi.waitForRequest("escalateToHuman");
      expect(req.method).toBe("POST");
      expect(req.body).toMatchObject({ name: "רונית אבני", phone: "052-7654321" });
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
    await handoffForm(section).getByLabel("טלפון").fill("052-7654321");
    await section.getByRole("button", { name: "שלחו לדורית" }).click();
    const req = await mockApi.waitForRequest("escalateToHuman");
    expect(req.method).toBe("POST");
  });
});
/**
 * What the chat does when the backend says no.
 *
 * Nothing in the battery exercised a failing `/agents/` call until these — the
 * `catch` in `AgentChat.send()` had never once executed under test. That is not
 * an academic gap: `allow_anonymous_access: false` made every conversation 401
 * for ten days, and the only thing the visitor got was one line telling them to
 * try again (A-42).
 */
test.describe("Agent chat — when the backend refuses", () => {
  test("a refused conversation gives the visitor their message back", async ({ page, mockApi }) => {
    await gotoApp(page, "/");
    const section = page.locator(INTERVIEW);
    const box = section.getByLabel("הודעה לסוכן ההיכרות");

    await test_step("accept the notice so the box unlocks", async () => {
      await section.getByRole("checkbox").check();
      await section.getByRole("button", { name: "התחלת השיחה" }).click();
      await expect(box).toBeEnabled();
    });

    await test_step("the backend refuses the conversation, exactly as production did", async () => {
      mockApi.failOn("/agents/", 401, {
        detail: "User must be authenticated to create a conversation",
      });
    });

    const typed = "שלום, אני מתלבטת לגבי הפנסיה";

    await test_step("the failure is reported rather than swallowed", async () => {
      await box.fill(typed);
      await section.getByRole("button", { name: "שליחה" }).click();
      await expect(section.getByText(/לא הצלחתי לשלוח את ההודעה כרגע/)).toBeVisible();
    });

    await test_step("and what the visitor wrote is still where they can send it again", async () => {
      // The user's own message reaches the transcript only by way of the server
      // echoing it back, so before this it was nowhere at all: cleared from the
      // box, absent from the conversation, one apology in its place.
      await expect(box).toHaveValue(typed);
    });
  });

  test("the direct channels appear even when the escalation itself fails", async ({
    page,
    mockApi,
  }) => {
    await gotoApp(page, "/");
    const section = page.locator(INTERVIEW);

    await test_step("escalateToHuman is down", async () => {
      mockApi.failOn("escalateToHuman", 500);
    });

    await test_step("a visitor who asked for a person still gets one", async () => {
      await section.getByRole("button", { name: "מעבר לטיפול אנושי" }).click();
      await handoffForm(section).getByLabel("טלפון").fill("052-7654321");
      await section.getByRole("button", { name: "שלחו לדורית" }).click();
      await expect(section.getByRole("link", { name: /050-831-1776/ })).toBeVisible();
      await expect(section.getByRole("link", { name: "וואטסאפ", exact: true })).toBeVisible();
    });
  });

  test("a visitor who will not leave a number still gets hers, and nobody is paged", async ({
    page,
    mockApi,
  }) => {
    await gotoApp(page, "/");
    const section = page.locator(INTERVIEW);

    await test_step("the second door is there", async () => {
      await section.getByRole("button", { name: "מעבר לטיפול אנושי" }).click();
      await section.getByRole("button", { name: "רק הפרטים של דורית" }).click();
      await expect(section.getByRole("link", { name: /050-831-1776/ })).toBeVisible();
    });

    await test_step("and it raised no alert she could not act on", async () => {
      expect(mockApi.requestsTo("escalateToHuman")).toHaveLength(0);
    });
  });

  test("sending with no number asks for one instead of paging her empty-handed", async ({
    page,
    mockApi,
  }) => {
    await gotoApp(page, "/");
    const section = page.locator(INTERVIEW);

    await section.getByRole("button", { name: "מעבר לטיפול אנושי" }).click();
    await handoffForm(section).getByLabel("שם").fill("רונית אבני");
    await section.getByRole("button", { name: "שלחו לדורית" }).click();

    await expect(section.getByRole("alert")).toHaveText(/מספר טלפון/);
    expect(mockApi.requestsTo("escalateToHuman")).toHaveLength(0);
  });
});
