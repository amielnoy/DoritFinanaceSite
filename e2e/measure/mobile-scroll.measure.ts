import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { gotoApp, test } from "../fixtures/app";

/**
 * How far a phone visitor scrolls on / and /faq, and how much room the support
 * chat gives its messages. Run with playwright.measure.config.ts; see there.
 *
 * Numbers, not assertions: the behaviour this measured is pinned by
 * e2e/ui/mobile.spec.ts. This exists to say "6.4 screens before, N after".
 * It also breaks /faq into its parts, reports where the topics row sits once
 * scrolled and how far a question moves when opened, and with SHOTS_DIR takes
 * whole-page shots at 390 and 1440 — compare the 1440 ones with `cmp`.
 *
 * Every scroll here is `behavior: "instant"`: the site sets
 * `scroll-behavior: smooth`, and a measurement taken mid-glide is wrong.
 */

const OUT = process.env.MEASURE_OUT;
const SHOTS = process.env.SHOTS_DIR;
const LABEL = process.env.MEASURE_LABEL || "run";

/** Belt and braces over the fixture's stubs: nothing leaves localhost. */
async function localhostOnly(page: Page): Promise<void> {
  await page.route(
    (url) => !["127.0.0.1", "localhost"].includes(url.hostname),
    (route) => route.abort(),
  );
  await page.routeWebSocket(/.*/, (ws) => ws.close());
}

/** Every top-level block of <main>, by height. */
async function sections(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // Lazy sections and reveal animations settle; scroll through once.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 30));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  return page.evaluate(() => {
    const main = document.querySelector("main");
    const vh = window.innerHeight;
    const blocks = Array.from(main?.children ?? []).map((el) => {
      const h = Math.round(el.getBoundingClientRect().height);
      const heading = el.querySelector("h1, h2")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 28) ?? "";
      return { block: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} ${heading}`.trim(), height: h, screens: +(h / vh).toFixed(2) };
    });
    const footer = document.querySelector("footer");
    if (footer) blocks.push({ block: "footer", height: Math.round(footer.getBoundingClientRect().height), screens: +(footer.getBoundingClientRect().height / vh).toFixed(2) });
    const scrollHeight = document.documentElement.scrollHeight;
    return { viewport: `${window.innerWidth}x${vh}`, scrollHeight, screens: +(scrollHeight / vh).toFixed(2), blocks };
  });
}

const height = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? Math.round(el.getBoundingClientRect().height) : null;
  }, selector);

/** The support chat's two regions, by their data attribute or (before it existed) by class. */
const NOTICE = '#support-chat [data-chat-region="notice"], #support-chat .absolute.inset-0.overflow-y-auto';
const MESSAGES = '#support-chat [data-chat-region="messages"], #support-chat .flex-1.overflow-y-auto.space-y-3\\.5';

async function openSupportChat(page: Page) {
  const section = page.locator("#support-chat");
  await section.scrollIntoViewIfNeeded();
  const opener = section.getByRole("button", { name: "שאלו את העוזר" });
  if (await opener.isVisible().catch(() => false)) await opener.click();
}

async function acceptConsent(page: Page) {
  const section = page.locator("#support-chat");
  await section.getByRole("checkbox").check();
  await section.getByRole("button", { name: "התחלת השיחה" }).click();
  await section.getByLabel("הודעה לסוכן התמיכה").waitFor();
}

/** Scroll through once so every Reveal has played, then wait out its 0.7 s. */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 300) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    // The desktop's scroll-progress line (SecurityScroll) can keep the value
    // of a scroll event from the loop above; one more, at the top, settles it.
    await new Promise((r) => setTimeout(r, 100));
    window.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(1200);
}

/** The parts of /faq that make up its height, by selectors that hold before and after stage 2. */
async function faqParts(page: Page) {
  return page.evaluate(() => {
    const h = (el: Element | null | undefined) => (el ? Math.round(el.getBoundingClientRect().height) : null);
    const main = document.querySelector("main");
    const hero = main?.querySelector(":scope > section");
    const aside = main?.querySelector("aside");
    const topics = aside?.querySelector("button")?.parentElement;
    const asideBox = aside?.querySelector("a[href='/#start']")?.closest("div.border");
    const panel = Array.from(aside?.parentElement?.lastElementChild?.children ?? []).find(
      (c) => !(c as HTMLElement).hidden,
    );
    const faqSection = aside?.closest("section");
    const cta = document.querySelector("[data-track-location='faq']");
    const ctaRow = cta?.querySelector("a[href^='tel:']")?.parentElement;
    return {
      header: h(document.querySelector("header")),
      mainPaddingTop: main ? parseFloat(getComputedStyle(main).paddingTop) : null,
      hero: h(hero),
      h1: h(main?.querySelector("h1")),
      heroIntro: h(hero?.querySelector("p")),
      credentials: h(hero?.nextElementSibling),
      faqSection: h(faqSection),
      aside: h(aside),
      topicsRow: h(topics),
      asideContactBox: h(asideBox),
      visiblePanel: h(panel as Element | undefined),
      supportChat: h(document.querySelector("#support-chat")),
      ctaSection: h(cta),
      ctaButtonsRow: h(ctaRow),
      footer: h(document.querySelector("footer")),
    };
  });
}

/**
 * Open the second question while the first is open, and report how far the
 * clicked question moved on screen. 0 is the brief.
 */
async function questionShift(page: Page) {
  const panel = page.locator("main aside ~ div > div:not([hidden])").first();
  // Not the glossary terms inside an open answer, which carry aria-expanded too.
  const triggers = panel.locator("button[aria-expanded]:not([data-term])");
  await triggers.nth(0).click();
  await page.waitForTimeout(500);
  const second = triggers.nth(1);
  await second.evaluate((el) => {
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top - 400, behavior: "instant" });
  });
  await page.waitForTimeout(300);
  const before = await second.evaluate((el) => el.getBoundingClientRect().top);
  await second.click();
  await page.waitForTimeout(600);
  const after = await second.evaluate((el) => el.getBoundingClientRect().top);
  return {
    clickedQuestionTopBefore: Math.round(before),
    clickedQuestionTopAfter: Math.round(after),
    shift: Math.round(after - before),
    firstStillOpen: (await triggers.nth(0).getAttribute("aria-expanded")) === "true",
  };
}

/** Where the topics row sits after scrolling into the questions: pinned under the header, or gone. */
async function topicsWhenScrolled(page: Page) {
  return page.evaluate(async () => {
    const aside = document.querySelector("main aside");
    const row = aside?.querySelector("button")?.parentElement;
    const panel = aside?.parentElement?.lastElementChild as HTMLElement | undefined;
    if (!row || !panel) return null;
    window.scrollTo({ top: panel.getBoundingClientRect().top + window.scrollY + 120, behavior: "instant" });
    await new Promise((r) => setTimeout(r, 300));
    const header = document.querySelector("header")!.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return { headerBottom: Math.round(header.bottom), topicsTop: Math.round(r.top), topicsBottom: Math.round(r.bottom), onScreen: r.bottom > 0 && r.top < window.innerHeight };
  });
}

/**
 * The home page's parts below md: what each section spends, and the pieces the
 * stage-3 brief names. Selectors hold before and after, so the two runs compare.
 */
async function homeParts(page: Page) {
  return page.evaluate(() => {
    const h = (el: Element | null | undefined) => (el ? Math.round(el.getBoundingClientRect().height) : null);
    const vh = window.innerHeight;
    const hero = document.querySelector("#top");
    const visible = (el: Element) => (el as HTMLElement).offsetParent !== null;
    const portrait = Array.from(hero?.querySelectorAll("img") ?? []).filter(visible)[0];
    const carriers = document.querySelector("main > section:nth-of-type(2)");
    const start = document.querySelector("#start");
    const bar = document.querySelector("[data-track-location='mobile_sticky_bar']");
    const main = document.querySelector("main");
    const body = document.body;
    const firstCta = Array.from(hero?.querySelectorAll("a[href$='#start']") ?? []).find(visible);
    const ctaTop = firstCta ? Math.round(firstCta.getBoundingClientRect().bottom) : null;
    return {
      hero: h(hero),
      heroPortrait: portrait ? `${Math.round(portrait.getBoundingClientRect().width)}x${Math.round(portrait.getBoundingClientRect().height)}` : null,
      heroCtaBottom: ctaTop,
      heroCtaAboveFold: ctaTop !== null && ctaTop <= vh,
      carriers: h(carriers),
      about: h(document.querySelector("#about")),
      services: h(document.querySelector("#services")),
      start: h(start),
      wizard: h(document.querySelector("#interview")),
      quickContact: h(document.querySelector("#quick-contact")),
      proof: h(document.querySelector("#proof")),
      testimonials: h(document.querySelector("#testimonials")),
      commonQuestions: h(document.querySelector("#common-questions")),
      footer: h(document.querySelector("footer")),
      stickyBar: h(bar),
      bottomClearance: Math.max(
        main ? parseFloat(getComputedStyle(main).paddingBottom) : 0,
        body ? parseFloat(getComputedStyle(body).paddingBottom) : 0,
        parseFloat(getComputedStyle(main?.parentElement ?? body).paddingBottom) || 0,
      ),
    };
  });
}

const results: Record<string, unknown> = {};

test.afterAll(() => {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${LABEL} ===\n${JSON.stringify(results, null, 2)}`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
});

test.describe("phone, 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test("/", async ({ page }) => {
    await localhostOnly(page);
    await gotoApp(page, "/");
    results["/ @390"] = await sections(page);
  });

  test("/ anatomy: each section, and whole-page shots", async ({ page }) => {
    await localhostOnly(page);
    await gotoApp(page, "/");
    await settle(page);
    results["/ @390 parts"] = await homeParts(page);
    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOTS, `${LABEL}-390-home-top.png`) });
      await page.screenshot({ path: path.join(SHOTS, `${LABEL}-390-home-full.png`), fullPage: true });
    }
  });

  test("/faq and its support chat", async ({ page }) => {
    await localhostOnly(page);
    await gotoApp(page, "/faq");
    results["/faq @390"] = await sections(page);

    await page.evaluate(() => document.querySelector("#support-chat")?.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(300);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${LABEL}-390-faq-card.png`) });
    await openSupportChat(page);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${LABEL}-390-faq-consent.png`) });
    const chat: Record<string, number | null> = {
      noticeRegionBeforeConsent: await height(page, NOTICE),
    };
    await acceptConsent(page);
    chat.messagesAreaAfterConsent = await height(page, MESSAGES);
    chat.pageScrollHeightWithChatOpen = await page.evaluate(() => document.documentElement.scrollHeight);
    results["/faq @390 chat"] = chat;
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${LABEL}-390-faq-chat-open.png`) });
  });

  test("/faq anatomy: its parts, the topics row, and whether opening a question moves it", async ({ page }) => {
    await localhostOnly(page);
    await gotoApp(page, "/faq");
    await settle(page);
    results["/faq @390 parts"] = await faqParts(page);
    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOTS, `${LABEL}-390-faq-top.png`) });
      await page.screenshot({ path: path.join(SHOTS, `${LABEL}-390-faq-full.png`), fullPage: true });
    }
    results["/faq @390 topics scrolled"] = await topicsWhenScrolled(page);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${LABEL}-390-faq-scrolled.png`) });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    results["/faq @390 open second question"] = await questionShift(page);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${LABEL}-390-faq-question-open.png`) });
  });
});

test.describe("desktop, 1440x900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("/ whole page, for a byte-for-byte comparison", async ({ page }) => {
    await localhostOnly(page);
    await gotoApp(page, "/");
    await settle(page);
    if (SHOTS) {
      // animations: "disabled" ends the hero's fade-up where it lands, so two
      // runs of the same build are byte-identical and a diff means a change.
      // Shot before `sections`, whose own scroll-through can leave the
      // scroll-progress line (SecurityScroll) at the bottom's value.
      await page.screenshot({ path: path.join(SHOTS, `${LABEL}-1440-home-top.png`), animations: "disabled" });
      await page.screenshot({ path: path.join(SHOTS, `${LABEL}-1440-home-full.png`), fullPage: true, animations: "disabled" });
    }
    results["/ @1440"] = await sections(page);
  });

  test("/faq and its support chat", async ({ page }) => {
    await localhostOnly(page);
    await gotoApp(page, "/faq");
    results["/faq @1440"] = await sections(page);
    const section = page.locator("#support-chat");
    await section.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.querySelector("#support-chat")?.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(400);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${LABEL}-1440-faq-card.png`) });
    const chat: Record<string, number | null> = { noticeRegionBeforeConsent: await height(page, NOTICE) };
    await acceptConsent(page);
    chat.messagesAreaAfterConsent = await height(page, MESSAGES);
    results["/faq @1440 chat"] = chat;
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${LABEL}-1440-faq-chat-open.png`) });
  });

  test("/faq whole page, for a byte-for-byte comparison", async ({ page }) => {
    await localhostOnly(page);
    await gotoApp(page, "/faq");
    await settle(page);
    results["/faq @1440 parts"] = await faqParts(page);
    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOTS, `${LABEL}-1440-faq-top.png`) });
      await page.screenshot({ path: path.join(SHOTS, `${LABEL}-1440-faq-full.png`), fullPage: true });
    }
    results["/faq @1440 open second question"] = await questionShift(page);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${LABEL}-1440-faq-question-open.png`) });
  });
});
