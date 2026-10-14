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
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 30));
    }
    window.scrollTo(0, 0);
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
});

test.describe("desktop, 1440x900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

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
});
