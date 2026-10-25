import { expect, gotoApp, test, test_step } from "../fixtures/app";

/**
 * Mobile-web sanity for the two platforms that matter to this site's traffic:
 * iOS Safari (WebKit / iPhone 14) and Android Chrome (Chromium / Pixel 7).
 * Tagged `@mobile-only` and `@desktop-only`, so each project collects only
 * its half — see the `grepInvert` on the projects in playwright.config.ts.
 */

/**
 * The sticky bar's links duplicate labels used in the footer and the
 * section nav, so scope to the bar itself (MobileStickyBar's root classes).
 */
const stickyBar = (page: import("@playwright/test").Page) =>
  page.locator("div.md\\:hidden.fixed.bottom-0");

/** The GA4 events the page queued (the inline gtag stub; the real tag is blocked), with their location. */
const queuedClicks = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? [])
      .map((entry) => Array.from(entry))
      .filter((args) => args[0] === "event")
      .map((args) => ({ name: String(args[1]), location: (args[2] as { location?: string } | undefined)?.location })),
  );

test.describe("Mobile web (iOS + Android)", { tag: "@mobile-only" }, () => {
  test("renders one 64px sticky bar — לשיחה קצרה, WhatsApp, a call, support — instead of the desktop dock", async ({ page }) => {
    await test_step("open the home page on a phone viewport", async () => {
      await gotoApp(page);
    });

    await test_step("the bar offers the conversation, WhatsApp, a call and support, and nothing else", async () => {
      const cta = stickyBar(page).getByRole("link", { name: "קביעת שיחה" });
      const stickyWhatsapp = stickyBar(page).getByRole("link", { name: /וואטסאפ/ });
      const stickyCall = stickyBar(page).getByRole("link", { name: /חייגו/ });
      const stickySupport = stickyBar(page).getByRole("link", { name: /שאלה לעוזר/ });
      await expect(stickyBar(page).getByRole("link")).toHaveCount(4);
      for (const link of [cta, stickyWhatsapp, stickyCall, stickySupport]) await expect(link).toBeVisible();
      await expect(cta).toHaveAttribute("href", "/#start");
      await expect(stickyWhatsapp).toHaveAttribute("href", /^https:\/\/wa\.me\/972508311776\?text=/);
      await expect(stickyCall).toHaveAttribute("href", "tel:+972508311776");
      await expect(stickySupport).toHaveAttribute("href", "/faq#support-chat");
    });

    await test_step("one 64px bar, four cells in a row, the CTA the widest", async () => {
      const bar = (await stickyBar(page).boundingBox())!;
      expect(Math.round(bar.height)).toBe(64);
      const boxes = await Promise.all(
        ["קביעת שיחה", /וואטסאפ/, /חייגו/, /שאלה לעוזר/].map(async (name) => (await stickyBar(page).getByRole("link", { name }).boundingBox())!),
      );
      const [cta, ...rest] = boxes;
      // The two-word cells (קביעת שיחה, שאלה לעוזר) share the widest width.
      for (const b of rest) expect(cta.width).toBeGreaterThanOrEqual(b.width - 0.5);
      for (const b of boxes) {
        expect(Math.round(Math.abs(b.y + b.height / 2 - (bar.y + bar.height / 2)))).toBeLessThanOrEqual(1);
        expect(b.height).toBeGreaterThanOrEqual(44);
      }
    });

    await test_step("no other button floats over the page: the desktop dock is hidden below md", async () => {
      await expect(page.getByRole("link", { name: "פתיחת שיחה בוואטסאפ" })).toBeHidden();
      await expect(page.locator('[data-track-location="floating_dock"]')).toBeHidden();
    });
  });

  test("each of the bar's three contact cells reports to GA4 from location mobile_sticky_bar", async ({ page }) => {
    await gotoApp(page);
    // Keep the page: the tracker listens in the capture phase, before this.
    await page.evaluate(() => window.addEventListener("click", (e) => e.preventDefault()));
    for (const name of ["קביעת שיחה", /וואטסאפ/, /חייגו/] as const) {
      await stickyBar(page).getByRole("link", { name }).click();
    }
    const events = await queuedClicks(page);
    for (const name of ["cta_click", "click_whatsapp", "click_phone"]) {
      expect(events).toContainEqual({ name, location: "mobile_sticky_bar" });
    }
  });

  test("the sticky bar's לשיחה קצרה reaches the conversation from another route", async ({ page }) => {
    // The bar is on every route and `#start` only on home. As a bare `#start`
    // it would do nothing at all on /blog.
    await test_step("open the blog on a phone viewport", async () => {
      await gotoApp(page, "/blog");
    });

    await test_step("tap לשיחה קצרה in the sticky bar", async () => {
      await stickyBar(page).getByRole("link", { name: "קביעת שיחה" }).click();
    });

    await test_step("it lands on the home page at the conversation", async () => {
      await expect(page).toHaveURL(/\/#start$/);
      await expect(page.locator("#start")).toBeInViewport({ ratio: 0.05 });
    });
  });

  test("a link to /#quick-contact opens the short form, which a phone otherwise keeps folded", async ({ page }) => {
    // The bar used to link here; the address still works for anyone holding it.
    await gotoApp(page, "/#quick-contact");
    await expect(page.locator("#qc-name")).toBeVisible();
    await expect(page.getByRole("button", { name: "השארת פרטים" })).toHaveAttribute("aria-expanded", "true");
  });

  test("nothing at the bottom of the page hides under the bar", async ({ page }) => {
    for (const path of ["/", "/blog"]) {
      await test_step(`${path}: the footer's last line ends above the bar`, async () => {
        await gotoApp(page, path);
        // /blog's list arrives after the route commits, so the bottom moves:
        // scroll again on every try until it holds.
        await expect
          .poll(async () => {
            await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
            const last = await page.locator("footer p").last().boundingBox();
            const bar = await stickyBar(page).boundingBox();
            // The gap between the footer's last line and the top of the bar.
            return last && bar ? bar.y - (last.y + last.height) : -1;
          })
          .toBeGreaterThanOrEqual(0);
      });
    }
  });

  test("E2E-MOB-036: an article's contact box fits the phone and nothing covers it", async ({ page }) => {
    await gotoApp(page, "/blog/post-1");
    const box = page.getByTestId("article_end");
    await expect(box).toBeVisible();
    await test_step("an article has no sticky bar to sit under (only / and /blog mount it)", async () => {
      await expect(stickyBar(page)).toHaveCount(0);
    });
    await test_step("the box fits the screen's width", async () => {
      const b = (await box.boundingBox())!;
      const width = page.viewportSize()!.width;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(width);
    });
    await test_step("its WhatsApp button is tappable", async () => {
      await box.getByRole("link", { name: /וואטסאפ/ }).click({ trial: true });
    });
  });

  test("the sticky bar stays pinned while scrolling", async ({ page }) => {
    await test_step("open the home page and scroll down to the testimonials", async () => {
      await gotoApp(page);
      await page.locator("#testimonials").scrollIntoViewIfNeeded();
    });

    await test_step("the call button is still on screen", async () => {
      await expect(stickyBar(page).getByRole("link", { name: /חייגו/ })).toBeInViewport();
    });
  });

  test("opens and closes the burger menu and navigates from it", async ({ page }) => {
    await test_step("open the home page", async () => {
      await gotoApp(page);
    });

    await test_step("tap the burger button", async () => {
      const burger = page.getByRole("button", { name: "תפריט" });
      await expect(burger).toBeVisible();
      await burger.tap();
    });

    const drawer = page.getByRole("navigation").last();

    await test_step("the drawer opens with the site's links", async () => {
      await expect(page.getByRole("button", { name: "סגירת תפריט" })).toBeVisible();
      await expect(drawer.getByRole("link", { name: "בלוג" })).toBeVisible();
    });

    await test_step("tapping a link inside the drawer navigates", async () => {
      await drawer.getByRole("link", { name: "בלוג" }).tap();
      await expect(page).toHaveURL(/\/blog$/);
    });
  });

  test("the burger menu closes on Escape and on backdrop tap", async ({ page }) => {
    await test_step("open the home page and the burger menu", async () => {
      await gotoApp(page);
      await page.getByRole("button", { name: "תפריט" }).tap();
      await expect(page.getByRole("button", { name: "סגירת תפריט" })).toBeVisible();
    });

    await test_step("pressing Escape closes the drawer", async () => {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "סגירת תפריט" })).toBeHidden();
    });
  });

  test("no page scrolls horizontally on a phone viewport", async ({ page }) => {
    for (const path of ["/", "/blog", "/claims", "/privacy", "/accessibility", "/faq"]) {
      await test_step(`${path} fits the phone's width`, async () => {
        await gotoApp(page, path);
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        // 1px of rounding slack; anything more is a real layout break.
        expect(overflow.scrollWidth - overflow.clientWidth, `${path} overflows horizontally`).toBeLessThanOrEqual(1);
      });
    }
  });

  test("primary tap targets meet the 44px minimum", async ({ page }) => {
    await test_step("open the home page", async () => {
      await gotoApp(page);
    });

    await test_step("every primary control is big enough to hit with a thumb", async () => {
      const targets = [
        stickyBar(page).getByRole("link", { name: "קביעת שיחה" }),
        stickyBar(page).getByRole("link", { name: /וואטסאפ/ }),
        stickyBar(page).getByRole("link", { name: /חייגו/ }),
        stickyBar(page).getByRole("link", { name: /שאלה לעוזר/ }),
        page.getByRole("button", { name: "תפריט" }),
        page.locator("#top").getByRole("link", { name: "בדיקת תיק פנסיוני" }),
        page.locator("#start").getByRole("link", { name: "וואטסאפ" }),
        page.locator("#start").getByRole("link", { name: "טלפון" }),
        page.locator("#start").getByRole("button", { name: "השארת פרטים" }),
        page.locator("#start").getByRole("button", { name: "צ'אט" }),
        page.locator("#services").getByRole("button", { name: /מיסוי וקיבוע זכויות/ }),
        page.locator("#about").getByRole("button", { name: "עוד עליי" }),
        page.locator("#common-questions").getByRole("link", { name: "לכל השאלות" }),
        page.locator("footer").getByText("ניווט באתר"),
        page.locator("#testimonials").getByRole("button", { name: "ההמלצה הבאה" }),
      ];

      for (const target of targets) {
        const box = await target.boundingBox();
        expect(box, "tap target is not rendered").not.toBeNull();
        expect(Math.max(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
        expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(36);
      }
    });
  });

  test("the phone keyboard gets the right input types", async ({ page }) => {
    const form = page.locator("#quick-contact");

    await test_step("open the home page and open the quick contact form from its chip", async () => {
      await gotoApp(page);
      await page.locator("#start").getByRole("button", { name: "השארת פרטים" }).click();
      await form.scrollIntoViewIfNeeded();
    });

    await test_step("phone and email fields ask for the matching keyboard", async () => {
      await expect(form.locator("#qc-phone")).toHaveAttribute("type", "tel");
      await expect(form.locator("#qc-email")).toHaveAttribute("type", "email");
    });
  });

  test("a visitor can submit the quick contact form by touch", async ({ page, mockApi }) => {
    const form = page.locator("#quick-contact");

    await test_step("open the home page and tap השארת פרטים under the questionnaire", async () => {
      await gotoApp(page);
      // tap() scrolls the chip into view itself, and retries while it settles.
      await page.locator("#start").getByRole("button", { name: "השארת פרטים" }).tap();
      await expect(form).toBeVisible();
    });

    await test_step("fill the form using taps only", async () => {
      await form.locator("#qc-name").tap();
      await form.locator("#qc-name").fill("ישראלה");
      await form.locator("#qc-phone").fill("050-1234567");
      await form.getByRole("button", { name: "שליחת הודעה" }).tap();
    });

    await test_step("the message is confirmed and the lead reaches the backend", async () => {
      await expect(form.getByText("ההודעה נשלחה. תודה.")).toBeVisible();
      const lead = await mockApi.waitForRequest("/functions/v1/submit-lead");
      expect(lead.body).toMatchObject({ source: "quick" });
    });
  });

  test("the calculator is usable on a narrow screen", async ({ page }) => {
    const section = page.locator("#fee-calculator");

    await test_step("open the tools page and scroll to the fee calculator", async () => {
      await gotoApp(page, "/tools");
      await section.scrollIntoViewIfNeeded();
    });

    await test_step("its inputs are reachable and still compute a number", async () => {
      const input = section.getByLabel("הפקדה חודשית (₪)");
      await expect(input).toBeVisible();
      await input.fill("3000");
      await expect(section).not.toContainText("NaN");
    });
  });

  test("the hero caption stays on one line, even with enlarged text", async ({ page }) => {
    await test_step("open the home page on a phone viewport", async () => {
      await gotoApp(page);
    });

    // 1.3 stands in for a phone's large-text setting, which scales px sizes too.
    for (const zoom of [1, 1.3]) {
      await test_step(`at ${zoom}x text`, async () => {
        await page.evaluate((z) => {
          (document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = String(z);
        }, zoom);

        const licence = page.locator("#top figcaption").getByText("L-00107009");
        await expect(licence).toBeVisible();
        const lines = await licence.evaluate((el) => {
          const lh = parseFloat(getComputedStyle(el).lineHeight);
          return Math.round(el.getBoundingClientRect().height / (lh * (parseFloat(document.body.style.zoom) || 1)));
        });
        expect(lines, "the licence number sits on one line").toBe(1);
      });
    }
  });

  test("every sticky-bar label fits on one line, even with enlarged text", async ({ page }) => {
    await test_step("open the home page on a phone viewport", async () => {
      await gotoApp(page);
      // The fonts are self-hosted, so this measures the face a visitor sees —
      // not the wide fallback CI's Linux WebKit used while Google Fonts was blocked.
      await page.evaluate(() => document.fonts.ready);
    });

    // 1.3 stands in for a phone's large-text setting, which scales px sizes too.
    // 360 is the narrowest common Android width; four cells must fit it too.
    for (const [width, zoom] of [[390, 1], [390, 1.3], [360, 1], [360, 1.3]] as const) {
      await test_step(`at ${width}px wide, ${zoom}x text`, async () => {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate((z) => {
          (document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = String(z);
        }, zoom);
        const links = stickyBar(page).getByRole("link");
        await expect(links).toHaveCount(4);
        const lines = await links.evaluateAll((els) =>
          els.map((el) => {
            // Count the distinct line tops the label's text actually occupies.
            const tops = new Set<number>();
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              if (!n.textContent?.trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(n);
              for (const r of Array.from(range.getClientRects())) if (r.width > 0) tops.add(Math.round(r.top));
            }
            return `${el.textContent?.trim()}: ${tops.size}`;
          }),
        );
        for (const line of lines) expect(line, "one line per label").toMatch(/: 1$/);
        // A one-word label cannot wrap, so it would spill instead: none may be
        // wider than its cell.
        const spills = await links.evaluateAll((els) =>
          els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent?.trim()),
        );
        expect(spills, "labels wider than their cells").toEqual([]);
      });
    }
  });

  test("the viewport meta allows pinch-zoom (no user-scalable=no)", async ({ page }) => {
    await test_step("open the home page", async () => {
      await gotoApp(page);
    });

    await test_step("the viewport is responsive and zoom is not blocked", async () => {
      const content = await page.locator('meta[name="viewport"]').getAttribute("content");
      expect(content).toContain("width=device-width");
      expect(content ?? "").not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
    });
  });
});

/**
 * The support chat on a phone: a card on /faq, and a full-screen layer.
 *
 * It was the chat itself, in a fixed 560px box: at 390x844 the consent notice
 * got 96px between a header that wrapped one word per line and the message
 * box, the conversation about 190px, and the box scrolled inside a page that
 * scrolled too. Below md the page now carries a card, and the chat is the
 * screen's height. Desktop is unchanged — e2e/ui/agent-compliance.spec.ts and
 * support-entry.spec.ts still drive it there.
 */
test.describe("Support chat on a phone (/faq)", { tag: "@mobile-only" }, () => {
  const SUPPORT = "#support-chat";
  const opener = (page: import("@playwright/test").Page) =>
    page.locator(SUPPORT).getByRole("button", { name: "שאלו את העוזר" });
  const layer = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "העוזר של דורית" });

  /** The GA4 events the page queued, from the inline gtag stub (the real tag is blocked by the fixture). */
  const queuedEvents = (page: import("@playwright/test").Page) =>
    page.evaluate(() =>
      ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? [])
        .map((entry) => Array.from(entry))
        .filter((args) => args[0] === "event")
        .map((args) => ({ name: String(args[1]), method: (args[2] as { method?: string } | undefined)?.method })),
    );

  test("the page shows a short card, with the fence closed behind <details>", async ({ page }) => {
    await test_step("open /faq on a phone", async () => {
      await gotoApp(page, "/faq");
      await page.locator(SUPPORT).scrollIntoViewIfNeeded();
    });

    await test_step("a heading, one sentence and one full-width button — not the chat", async () => {
      await expect(page.locator(SUPPORT).getByRole("heading", { name: "לא מצאתם את התשובה?" })).toBeVisible();
      await expect(opener(page)).toBeVisible();
      await expect(opener(page)).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(SUPPORT).getByLabel("הודעה לסוכן התמיכה")).toBeHidden();
      const box = (await opener(page).boundingBox())!;
      expect(box.height, "the button is a thumb-sized target").toBeGreaterThanOrEqual(44);
      expect(box.width, "the button is full width").toBeGreaterThan(page.viewportSize()!.width * 0.7);
    });

    await test_step("the section is a card, not a screen and a half", async () => {
      const height = await page.locator(SUPPORT).evaluate((el) => el.getBoundingClientRect().height);
      expect(height).toBeLessThan(page.viewportSize()!.height * 0.75);
    });

    await test_step("what the assistant does and does not do is one tap away, word for word", async () => {
      const details = page.locator(`${SUPPORT} details`);
      await expect(details).not.toHaveAttribute("open", /.*/);
      await expect(page.locator(SUPPORT).getByText("מה הוא לא עושה")).toBeHidden();
      await details.locator("summary").click();
      await expect(page.locator(SUPPORT).getByText("מה הוא לא עושה")).toBeVisible();
      await expect(page.locator(SUPPORT).getByText(/לא מפרש פוליסה ולא מטפל בתביעה או בתלונה/)).toBeVisible();
    });
  });

  test("the chat opens full-screen, with room for its messages and one scroll", async ({ page }) => {
    await test_step("open /faq and press שאלו את העוזר", async () => {
      await gotoApp(page, "/faq");
      await opener(page).click();
      await expect(layer(page)).toBeVisible();
      await expect(opener(page)).toHaveAttribute("aria-expanded", "true");
    });

    await test_step("the layer is the whole screen, and the page behind it does not scroll", async () => {
      const vp = page.viewportSize()!;
      const box = (await layer(page).boundingBox())!;
      expect(Math.round(box.x)).toBe(0);
      expect(Math.round(box.y)).toBe(0);
      expect(Math.abs(box.width - vp.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.height - vp.height)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
    });

    await test_step("its header is one row: who it is, that it is automatic, the way to a person", async () => {
      const title = layer(page).getByRole("heading", { name: "העוזר של דורית" });
      const subtitle = layer(page).getByText("אוטומטי · לא דורית עצמה");
      const handoff = layer(page).getByRole("button", { name: "מעבר לטיפול אנושי" });
      const close = layer(page).getByRole("button", { name: "סגירת הצ׳אט" });
      const [t, sub, h, c] = await Promise.all([title, subtitle, handoff, close].map((l) => l.boundingBox()));
      // One line each — the old header wrapped "עם / העוזר / של / דורית" one word per line.
      expect(t!.height).toBeLessThan(32);
      expect(sub!.height).toBeLessThan(24);
      // The hand-off and close buttons share the title's row.
      for (const b of [h!, c!]) {
        expect(b.y).toBeLessThan(sub!.y + sub!.height);
        expect(b.y + b.height).toBeGreaterThan(t!.y);
        expect(Math.min(b.width, b.height), "header control is a thumb-sized target").toBeGreaterThanOrEqual(44);
      }
    });

    await test_step("the consent notice gets the room, and is all there", async () => {
      const notice = layer(page).locator('[data-chat-region="notice"]');
      expect((await notice.boundingBox())!.height).toBeGreaterThan(300);
      await expect(layer(page).getByText(/L-00107009/)).toBeVisible();
      await expect(layer(page).getByRole("checkbox")).toBeInViewport();
      await expect(layer(page).getByRole("button", { name: "התחלת השיחה" })).toBeInViewport();
    });

    await test_step("after consent the messages take the screen, and nothing else scrolls", async () => {
      await layer(page).getByRole("checkbox").check();
      await layer(page).getByRole("button", { name: "התחלת השיחה" }).click();
      const messages = layer(page).locator('[data-chat-region="messages"]');
      expect((await messages.boundingBox())!.height).toBeGreaterThan(page.viewportSize()!.height * 0.5);
      const scrolls = await layer(page).evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(scrolls, "the layer itself scrolls — a second scroll").toBeLessThanOrEqual(1);
    });

    await test_step("the message box sits at the bottom, at 16px or more so iOS does not zoom", async () => {
      const box = layer(page).getByLabel("הודעה לסוכן התמיכה");
      await expect(box).toBeInViewport();
      const size = await box.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size).toBeGreaterThanOrEqual(16);
      // The notice does not come back: consent was given for this conversation.
      await expect(layer(page).getByRole("checkbox")).toHaveCount(0);
    });

    await test_step("chat_start reached GA4's queue, from inside the layer", async () => {
      expect(await queuedEvents(page)).toContainEqual({ name: "chat_start", method: "ai_support" });
    });

    await test_step("the hand-off button still reports chat_handoff", async () => {
      await layer(page).getByRole("button", { name: "מעבר לטיפול אנושי" }).click();
      await expect(layer(page).getByRole("form", { name: "מעבר לטיפול אנושי" })).toBeVisible();
      expect(await queuedEvents(page)).toContainEqual({ name: "chat_handoff", method: "ai_support" });
    });
  });

  test("Escape and the X close it, and focus goes back to the button", async ({ page }) => {
    await gotoApp(page, "/faq");

    await test_step("Escape closes the layer and unlocks the page", async () => {
      await opener(page).click();
      await expect(layer(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(layer(page)).toBeHidden();
      await expect(opener(page)).toBeFocused();
      await expect(opener(page)).toHaveAttribute("aria-expanded", "false");
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
    });

    await test_step("so does the X", async () => {
      await opener(page).click();
      await layer(page).getByRole("button", { name: "סגירת הצ׳אט" }).click();
      await expect(layer(page)).toBeHidden();
      await expect(opener(page)).toBeFocused();
    });
  });

  test("Tab stays inside the layer while it is open", async ({ page }) => {
    await gotoApp(page, "/faq");
    await opener(page).click();
    await expect(layer(page)).toBeVisible();

    const visited = new Set<string>();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(i % 4 === 3 ? "Shift+Tab" : "Tab");
      const where = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const el = document.activeElement as HTMLElement | null;
        return {
          inside: !!dialog && !!el && dialog.contains(el) && el !== dialog,
          name: el ? `${el.tagName}:${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 20)}` : "",
        };
      });
      expect(where.inside, `focus left the layer after ${i + 1} presses (${where.name})`).toBe(true);
      visited.add(where.name);
    }
    // It moves through the controls, not stuck on one.
    expect(visited.size).toBeGreaterThanOrEqual(3);
  });
});

/**
 * The rest of /faq on a phone: a one-line heading, the topics as a bar pinned
 * under the header, questions that do not move when opened, and the closing
 * band's three buttons on one row.
 *
 * At 390x844 the page was 4.91 screens. A screen and a half of it stood before
 * the first question: the kicker repeated the two-line heading word for word,
 * the topics were a 70px row a visitor scrolled away from for good, and a
 * contact box said what the support chat's card says right below. Opening a
 * question closed the one above it and pulled the clicked question 168px up
 * the screen. Desktop is unchanged — see the @desktop-only case after this.
 */
test.describe("/faq on a phone", { tag: "@mobile-only" }, () => {
  type Page = import("@playwright/test").Page;
  const topics = (page: Page) => page.getByRole("group", { name: "ניווט לפי נושא" });
  /** The questions of the topic on show; the other topics are in the HTML, hidden. */
  const questions = (page: Page) => page.locator("main h3 > button[aria-expanded]:visible");
  const headerBottom = (page: Page) =>
    page.evaluate(() => document.querySelector("header")!.getBoundingClientRect().bottom);
  /** Instant: the site scrolls smoothly, and a measurement mid-glide measures nothing. */
  const scrollIntoList = (page: Page, by: number) =>
    questions(page)
      .first()
      .evaluate((el, dy) => {
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY + dy, behavior: "instant" });
      }, by);

  test("the heading is one short line, and the document title is the same as before", async ({ page }) => {
    await gotoApp(page, "/faq");

    await test_step("one heading, on one line, with the first questions on the first screen", async () => {
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toHaveText(/^שאלות\s+ותשובות$/);
      expect((await h1.boundingBox())!.height, "the heading wraps").toBeLessThan(60);
      await expect(questions(page).first()).toBeInViewport();
    });

    await test_step("the <title> is untouched — only the visible heading is shorter", async () => {
      await expect(page).toHaveTitle("שאלות ותשובות — פנסיה, גמל, ביטוח ומיסוי | דורית גוב ארי");
    });
  });

  test("the topics are a bar pinned under the header, scrolling sideways", async ({ page }) => {
    await gotoApp(page, "/faq");
    const chips = topics(page).getByRole("button");

    await test_step("every topic is a real button, a thumb-sized target, and the row scrolls sideways", async () => {
      expect(await chips.count()).toBeGreaterThanOrEqual(3);
      for (const chip of await chips.all()) {
        expect(await chip.evaluate((el) => el.tagName)).toBe("BUTTON");
        expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      // One row that scrolls sideways when the topics outrun the screen (at
      // 390px they do; a Pixel 7's 412px just fits them), never a second line.
      expect(await topics(page).evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
      const tops = await Promise.all((await chips.all()).map(async (c) => Math.round((await c.boundingBox())!.y)));
      expect(new Set(tops).size, "the topics wrapped onto a second line").toBe(1);
      await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
    });

    await test_step("scrolled into the questions, the bar sits right under the header", async () => {
      await scrollIntoList(page, 120);
      const bar = (await topics(page).boundingBox())!;
      const bottom = await headerBottom(page);
      expect(bar.y).toBeGreaterThanOrEqual(bottom - 1);
      expect(bar.y).toBeLessThan(bottom + 16);
    });
  });

  test("a topic chosen from the pinned bar starts at its heading, clear of the bar", async ({ page }) => {
    await gotoApp(page, "/faq");
    const chips = topics(page).getByRole("button");
    const second = chips.nth(1);
    const label = (await second.textContent())!.trim();

    await scrollIntoList(page, 150);
    await second.click();
    await expect(second).toHaveAttribute("aria-pressed", "true");

    const heading = page.getByRole("heading", { level: 2, name: label });
    await expect(heading).toBeVisible();
    // Smooth scrolling: wait for it to land, then check nothing covers it.
    await expect
      .poll(async () => {
        const bar = (await topics(page).boundingBox())!;
        const h = (await heading.boundingBox())!;
        return h.y >= bar.y + bar.height && h.y < bar.y + bar.height + 60;
      })
      .toBe(true);
  });

  test("the topics are reachable from the keyboard", async ({ page, browserName }) => {
    await gotoApp(page, "/faq");
    const chips = topics(page).getByRole("button");
    const last = chips.last();

    await test_step("a topic off the edge of the bar scrolls into it when focused, and Enter opens it", async () => {
      expect(await last.evaluate((el) => (el as HTMLElement).tabIndex)).toBeGreaterThanOrEqual(0);
      await last.focus();
      await expect(last).toBeFocused();
      const bar = (await topics(page).boundingBox())!;
      await expect
        .poll(async () => {
          const b = (await last.boundingBox())!;
          return b.x >= bar.x - 1 && b.x + b.width <= bar.x + bar.width + 1;
        })
        .toBe(true);
      await page.keyboard.press("Enter");
      await expect(last).toHaveAttribute("aria-pressed", "true");
    });

    // Safari's own Tab skips buttons unless the visitor turns that on, so the
    // Tab order itself is asserted where Tab moves between buttons by default.
    if (browserName === "chromium") {
      await test_step("Tab walks the topics in order", async () => {
        await chips.first().focus();
        await page.keyboard.press("Tab");
        await expect(chips.nth(1)).toBeFocused();
      });
    }
  });

  test("opening a question leaves it where it was, and the one above stays open", async ({ page }) => {
    await gotoApp(page, "/faq");
    const first = questions(page).nth(0);
    const second = questions(page).nth(1);

    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    // Let its answer finish opening: it is above the question measured next.
    await page.waitForTimeout(500);
    await second.evaluate((el) =>
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 400, behavior: "instant" }),
    );
    const before = (await second.boundingBox())!.y;

    await second.click();
    await expect(second).toHaveAttribute("aria-expanded", "true");
    // Past the answer's opening animation.
    await page.waitForTimeout(500);
    expect(Math.abs((await second.boundingBox())!.y - before), "the clicked question moved").toBeLessThanOrEqual(1);
    await expect(first).toHaveAttribute("aria-expanded", "true");
  });

  test("עדיין מתלבטים? has its three buttons on one row, and each still reports to GA4", async ({ page }) => {
    await gotoApp(page, "/faq");
    const band = page.locator('[data-track-location="faq"]');
    const meeting = band.getByRole("link", { name: "קביעת פגישה" });
    const phone = band.getByRole("link", { name: "טלפון" });
    const whatsapp = band.getByRole("link", { name: "WhatsApp" });

    await test_step("one row of three, each a thumb-sized target, inside the screen", async () => {
      await band.scrollIntoViewIfNeeded();
      const boxes = await Promise.all([meeting, phone, whatsapp].map(async (l) => (await l.boundingBox())!));
      const width = page.viewportSize()!.width;
      for (const b of boxes) {
        expect(Math.abs(b.y - boxes[0].y), "not on one row").toBeLessThanOrEqual(1);
        expect(b.height).toBeGreaterThanOrEqual(44);
        expect(b.width).toBeGreaterThanOrEqual(44);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(width);
      }
      await expect(meeting).toHaveAttribute("href", "/#start");
      await expect(phone).toHaveAttribute("href", "tel:+972508311776");
      await expect(whatsapp).toHaveAttribute("href", /^https:\/\/wa\.me\/972508311776/);
    });

    await test_step("cta_click, click_phone and click_whatsapp reach GA4's queue, from location faq", async () => {
      // Keep the page: the tracker listens in the capture phase, before this.
      await page.evaluate(() => window.addEventListener("click", (e) => e.preventDefault()));
      for (const link of [meeting, phone, whatsapp]) await link.click();
      const events = await page.evaluate(() =>
        ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? [])
          .map((entry) => Array.from(entry))
          .filter((args) => args[0] === "event")
          .map((args) => ({ name: String(args[1]), location: (args[2] as { location?: string } | undefined)?.location })),
      );
      for (const name of ["cta_click", "click_phone", "click_whatsapp"]) {
        expect(events).toContainEqual({ name, location: "faq" });
      }
    });
  });
});

test.describe("/faq on a desktop", { tag: "@desktop-only" }, () => {
  test("keeps its sidebar, its contact box and its one-open-at-a-time questions", async ({ page }) => {
    await gotoApp(page, "/faq");

    await test_step("the sidebar's label and its contact box are there, as before", async () => {
      await expect(page.getByText("ניווט לפי נושא")).toBeVisible();
      await expect(page.getByText("לא מצאתם תשובה?")).toBeVisible();
      await expect(page.getByRole("link", { name: "יצירת קשר" })).toHaveAttribute("href", "/#start");
    });

    await test_step("opening a question closes the one that was open", async () => {
      const questions = page.locator("main h3 > button[aria-expanded]:visible");
      await questions.nth(0).click();
      await expect(questions.nth(0)).toHaveAttribute("aria-expanded", "true");
      await questions.nth(1).click();
      await expect(questions.nth(1)).toHaveAttribute("aria-expanded", "true");
      await expect(questions.nth(0)).toHaveAttribute("aria-expanded", "false");
    });

    await test_step("the closing band still shows the phone number itself", async () => {
      const band = page.locator('[data-track-location="faq"]');
      await expect(band.getByRole("link", { name: "050-831-1776" })).toBeVisible();
      await expect(band.getByText("טלפון", { exact: true })).toBeHidden();
    });
  });
});

test.describe("Desktop-only chrome", { tag: "@desktop-only" }, () => {

  test("shows the floating WhatsApp/phone dock and hides the mobile bar", async ({ page }) => {
    await test_step("open the home page on a desktop viewport", async () => {
      await gotoApp(page);
    });

    await test_step("the desktop dock is shown and the mobile bar is not", async () => {
      await expect(page.getByRole("link", { name: "פתיחת שיחה בוואטסאפ" })).toBeVisible();
      await expect(stickyBar(page).getByRole("link", { name: /חייגו/ })).toBeHidden();
    });
  });

  test("shows the full desktop nav rather than a burger", async ({ page }) => {
    await test_step("open the home page on a desktop viewport", async () => {
      await gotoApp(page);
    });

    await test_step("the burger is hidden and the full navigation is visible", async () => {
      await expect(page.getByRole("button", { name: "תפריט" })).toBeHidden();
      await expect(page.getByRole("link", { name: "שירותים" }).first()).toBeVisible();
    });
  });
});

/**
 * The home page on a phone (stage 3). At 390x844 it was 12.2 screens; below md
 * each section now says the same in less: a byline instead of a portrait taller
 * than the screen, one strip of carriers, one sentence about her, the services
 * folded, the alternatives to the questionnaire as chips, four questions, and a
 * footer whose menu folds. Desktop is pinned by "Home on a desktop" below.
 */
test.describe("Home on a phone", { tag: "@mobile-only" }, () => {
  type Page = import("@playwright/test").Page;
  const wizard = (page: Page) => page.locator("#interview");
  const stepHeading = (page: Page, name: string) => wizard(page).getByRole("heading", { name });
  /** The home page, live (gotoApp waits for the route to commit). */
  const gotoHome = async (page: Page, path = "/") => {
    await gotoApp(page, path);
  };
  const stepEvents = async (page: Page) =>
    (await queuedClicks(page)).filter((e) => e.name === "wizard_step").map((e) => e.location);

  test("the hero: an 88px round portrait beside the licence line, and one full-width CTA", async ({ page }) => {
    // The brief's screen, 390x844: the device descriptors' own heights differ
    // (an iPhone 14 in Playwright is 390x664, browser chrome taken off).
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoHome(page);
    const hero = page.locator("#top");
    const portrait = hero.locator("figure .plate");
    const licence = hero.locator("figcaption").getByText("L-00107009");
    // The hero's rows fade up for 0.9 s (`animate-fade-up`), and two boxes read
    // one after the other mid-glide differ by a pixel or two (android-chrome
    // failed 4 runs in 10 that way): let every finite animation land first.
    await hero.evaluate((el) =>
      Promise.all(
        el
          .getAnimations({ subtree: true })
          .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
          .map((a) => a.finished.catch(() => undefined)),
      ),
    );

    await test_step("the portrait is an 88px circle, on the licence line's row, above the headline", async () => {
      const box = (await portrait.boundingBox())!;
      expect(Math.round(box.width)).toBe(88);
      expect(Math.round(box.height)).toBe(88);
      expect(await portrait.evaluate((el) => getComputedStyle(el).borderRadius)).not.toBe("0px");
      const l = (await licence.boundingBox())!;
      expect(l.y).toBeGreaterThanOrEqual(box.y);
      expect(l.y + l.height).toBeLessThanOrEqual(box.y + box.height);
      const h1 = (await hero.getByRole("heading", { level: 1 }).boundingBox())!;
      expect(h1.y).toBeGreaterThan(box.y + box.height);
    });

    const cta = hero.getByRole("link", { name: "בדיקת תיק פנסיוני" });

    await test_step("the pension check is the one main button, across the column; WhatsApp and the call are the sticky bar's, once", async () => {
      const c = (await cta.boundingBox())!;
      const column = (await hero.locator("h1").boundingBox())!;
      expect(c.width).toBeGreaterThanOrEqual(column.width - 1);
      // Review 2026-10-25: the hero's own pair showed each a second time on the first screen.
      await expect(hero.getByRole("link", { name: "וואטסאפ" })).toHaveCount(0);
      await expect(hero.getByRole("link", { name: "חיוג" })).toHaveCount(0);
      const bar = stickyBar(page);
      await expect(bar.getByRole("link", { name: /וואטסאפ/ })).toBeVisible();
      await expect(bar.locator('a[href^="tel:"]')).toBeVisible();
      expect(c.y + c.height).toBeLessThanOrEqual((await bar.boundingBox())!.y);
    });

    await test_step("a phone fetches the small portrait, not the 1080 one", async () => {
      const src = await hero.locator("img").evaluate((img) => (img as HTMLImageElement).currentSrc);
      expect(src).toMatch(/-480\.(avif|webp)$/);
    });

    await test_step("the main button reports to GA4 from location top", async () => {
      await cta.click();
      const events = await queuedClicks(page);
      expect(events).toContainEqual({ name: "cta_click", location: "top" });
      await expect(page).toHaveURL(/\/pension-check$/);
    });
  });

  test("the carriers are one strip that scrolls sideways, and the keyboard reaches all of them", async ({ page }) => {
    await gotoHome(page);
    const strip = page.locator("main > section").nth(1).locator('a[href^="https://"]').first().locator("..");

    await test_step("one row, wider than the screen, scrolling inside itself", async () => {
      const links = strip.locator("a");
      await expect(links).toHaveCount(8);
      const tops = await links.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      expect(new Set(tops).size).toBe(1);
      const { scrollWidth, clientWidth, overflowX } = await strip.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        overflowX: getComputedStyle(el).overflowX,
      }));
      expect(scrollWidth).toBeGreaterThan(clientWidth);
      expect(overflowX).toBe("auto");
    });

    await test_step("the compliance line under it is still there", async () => {
      await expect(page.getByText(/כסוכנת\s+ביטוח, יש לי זיקה לגופים מוסדיים/)).toBeVisible();
    });

    await test_step("focusing the last carrier brings it into the strip", async () => {
      // focus() rather than Tab: WebKit does not tab to links by default, and
      // the scroll a focused link gets is the same either way.
      const last = strip.locator("a").last();
      await last.focus();
      await expect(last).toBeInViewport();
    });
  });

  test("about: one sentence, the three figures and the rest folded behind עוד עליי", async ({ page }) => {
    await gotoHome(page);
    const about = page.locator("#about");
    await about.scrollIntoViewIfNeeded();

    await test_step("the professional sentence shows, the personal one and the pictures do not", async () => {
      await expect(about.getByText(/ותיקה בתחומי\s+הפיננסים והביטוח/)).toBeVisible();
      await expect(about.getByText(/שמי דורית גוב ארי/)).toBeHidden();
      await expect(about.getByText(/שמי דורית גוב ארי/)).toHaveCount(1);
      expect(await about.locator("img").count()).toBeGreaterThanOrEqual(2);
      for (const img of await about.locator("img").all()) await expect(img).toBeHidden();
    });

    await test_step("a row of three figures", async () => {
      for (const n of ["30", "מאות", "1:1"]) await expect(about.getByText(n, { exact: true })).toBeVisible();
    });

    await test_step("עוד עליי unfolds the personal sentence in place, and offers the full story", async () => {
      const more = about.getByRole("button", { name: "עוד עליי" });
      await expect(more).toHaveAttribute("aria-expanded", "false");
      await expect(about.getByRole("link", { name: "הסיפור המלא" })).toHaveCount(0);
      await more.click();
      await expect(more).toHaveAttribute("aria-expanded", "true");
      await expect(about.getByText(/שמי דורית גוב ארי/)).toBeVisible();
      // Pressed again, it folds back.
      await more.click();
      await expect(about.getByText(/שמי דורית גוב ארי/)).toBeHidden();
      await more.click();
    });

    await test_step("הסיפור המלא goes to /perspective", async () => {
      await about.getByRole("link", { name: "הסיפור המלא" }).click();
      await expect(page).toHaveURL(/\/perspective$/);
    });
  });

  test("services: an accordion, the first open and the others closed, with the copy unchanged", async ({ page }) => {
    await gotoHome(page);
    const services = page.locator("#services");
    const triggers = services.locator("h3 > button[aria-expanded]");

    await test_step("five real buttons in headings; only the first is open", async () => {
      await expect(triggers).toHaveCount(5);
      await expect(triggers.nth(0)).toHaveAttribute("aria-expanded", "true");
      for (let i = 1; i < 5; i++) await expect(triggers.nth(i)).toHaveAttribute("aria-expanded", "false");
      await expect(services.getByText(/בחינת המוצרים הקיימים/)).toBeVisible();
      await expect(services.getByText(/תכנון מס לקראת פרישה/)).toBeHidden();
      // Folded, not removed: every description is still in the document.
      await expect(services.getByText(/ליווי צמוד ברגע האמת/)).toHaveCount(1);
    });

    await test_step("opening the second leaves the first open, and nothing above it moves", async () => {
      await triggers.nth(1).evaluate((el) =>
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 300, behavior: "instant" }),
      );
      const before = (await triggers.nth(1).boundingBox())!.y;
      await triggers.nth(1).click();
      await expect(triggers.nth(1)).toHaveAttribute("aria-expanded", "true");
      await expect(triggers.nth(0)).toHaveAttribute("aria-expanded", "true");
      await expect(services.getByText(/תכנון מס לקראת פרישה/)).toBeVisible();
      expect(Math.round((await triggers.nth(1).boundingBox())!.y - before)).toBe(0);
    });

    await test_step("and it closes again", async () => {
      await triggers.nth(1).click();
      await expect(triggers.nth(1)).toHaveAttribute("aria-expanded", "false");
      await expect(services.getByText(/תכנון מס לקראת פרישה/)).toBeHidden();
    });
  });

  test("start: the form waits behind a chip row — וואטסאפ · טלפון · השארת פרטים · צ'אט", async ({ page }) => {
    await gotoHome(page);
    const start = page.locator("#start");
    const form = page.locator("#quick-contact");
    const chips = start.getByRole("list", { name: "מעדיפים אחרת?" });

    await test_step("the short form is not standing open under the questionnaire", async () => {
      await expect(form).toBeHidden();
      await expect(start.getByRole("link", { name: "עדיף לי בוואטסאפ" })).toBeHidden();
    });

    await test_step("the row holds the four, in order", async () => {
      await expect(chips.getByRole("listitem")).toHaveText(["וואטסאפ", "טלפון", "השארת פרטים", "צ'אט"]);
      await expect(chips.getByRole("link", { name: "וואטסאפ" })).toHaveAttribute("href", /^https:\/\/wa\.me\/972508311776/);
      await expect(chips.getByRole("link", { name: "טלפון" })).toHaveAttribute("href", "tel:+972508311776");
    });

    await test_step("השארת פרטים opens the form in place, and closes it", async () => {
      const chip = chips.getByRole("button", { name: "השארת פרטים" });
      await expect(chip).toHaveAttribute("aria-expanded", "false");
      await expect(chip).toHaveAttribute("aria-controls", "quick-contact");
      await chip.click();
      await expect(chip).toHaveAttribute("aria-expanded", "true");
      await expect(form.locator("#qc-name")).toBeVisible();
      const chipBox = (await chip.boundingBox())!;
      const formBox = (await form.boundingBox())!;
      expect(formBox.y).toBeGreaterThan(chipBox.y);
      expect(formBox.y - (chipBox.y + chipBox.height)).toBeLessThan(120);
      await chip.click();
      await expect(form).toBeHidden();
    });

    await test_step("צ'אט opens the interview chat that was behind the link", async () => {
      const chip = chips.getByRole("button", { name: "צ'אט" });
      await expect(chip).toHaveAttribute("aria-controls", "interview-chat");
      await chip.click();
      await expect(chip).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("#interview-chat")).toBeVisible();
    });

    await test_step("WhatsApp and the phone report to GA4 from location start, as the tiles did", async () => {
      await page.evaluate(() => window.addEventListener("click", (e) => e.preventDefault()));
      await chips.getByRole("link", { name: "וואטסאפ" }).click();
      await chips.getByRole("link", { name: "טלפון" }).click();
      const events = await queuedClicks(page);
      expect(events).toContainEqual({ name: "click_whatsapp", location: "start" });
      expect(events).toContainEqual({ name: "click_phone", location: "start" });
    });
  });

  test("the questionnaire: three taps move on by themselves to the contact step, and report it", async ({ page }) => {
    await gotoHome(page);

    await test_step("the three questions, each moving on at a tap, with no list of steps", async () => {
      await expect(wizard(page).getByText("3 שאלות קצרות — פחות מדקה")).toBeVisible();
      await expect(wizard(page).getByText("שאלה 1 מתוך 3")).toBeVisible();
      await expect(wizard(page).getByRole("list", { name: "שלבי השאלון" })).toHaveCount(0);
      await wizard(page).getByText("דמי ניהול / הפנסיה שלי", { exact: true }).tap();
      await expect(stepHeading(page, "איפה את/ה בחיים כרגע?")).toBeFocused();
      await wizard(page).getByText("זוג בלי ילדים", { exact: true }).tap();
      await expect(stepHeading(page, "עד כמה זה דחוף?")).toBeVisible();
      await wizard(page).getByText("בחודשים הקרובים", { exact: true }).tap();
      await expect(stepHeading(page, "איך דורית תחזור אליך?")).toBeVisible();
      await expect(wizard(page).getByText("כמעט סיימנו")).toBeVisible();
    });

    await test_step("each move sent wizard_step for the screen it left, and one wizard_start", async () => {
      expect(await stepEvents(page)).toEqual(["step_1", "step_2", "step_3"]);
      const started = (await queuedClicks(page)).filter((e) => e.name === "wizard_start");
      expect(started).toHaveLength(1);
    });

    await test_step("the mobile field is a phone keyboard's, and a wrong number is answered under it", async () => {
      const phone = wizard(page).getByLabel("טלפון נייד");
      await expect(phone).toHaveAttribute("type", "tel");
      await expect(phone).toHaveAttribute("inputmode", "tel");
      await wizard(page).getByLabel("שם").fill("רונית");
      await phone.fill("03-1234567");
      await wizard(page).getByRole("button", { name: /שליחה לדורית/ }).click();
      await expect(phone).toHaveAttribute("aria-invalid", "true");
      await expect(wizard(page).getByText("מספר נייד צריך להתחיל ב-05 ולהכיל 10 ספרות")).toBeVisible();
      await expect(wizard(page).getByText("דורית חוזרת תוך יום עסקים")).toBeVisible();
    });

    await test_step("back still goes back, the answer kept", async () => {
      await wizard(page).getByRole("button", { name: "הקודם" }).click();
      await expect(stepHeading(page, "עד כמה זה דחוף?")).toBeVisible();
      await expect(wizard(page).getByRole("radio", { name: "בחודשים הקרובים" })).toBeChecked();
    });
  });

  test("E2E-MOB-037: on the smallest phone each step, button included, sits above the bar without a scroll", async ({ page }) => {
    // The brief of 2026-10-14. 375x667 is the smallest screen we design for.
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoHome(page);
    const bar = stickyBar(page);
    const fits = async (last: import("@playwright/test").Locator) => {
      await page.waitForTimeout(600); // the step's own scroll into place
      const b = (await last.boundingBox())!;
      return b.y >= 0 && b.y + b.height <= (await bar.boundingBox())!.y;
    };
    const lastAnswer = () => wizard(page).getByRole("radio").last().locator("xpath=..");
    await wizard(page).getByText("דמי ניהול / הפנסיה שלי", { exact: true }).tap();
    await expect(stepHeading(page, "איפה את/ה בחיים כרגע?")).toBeVisible();
    expect(await fits(lastAnswer()), "life stage").toBe(true);
    await wizard(page).getByText("זוג בלי ילדים", { exact: true }).tap();
    await expect(stepHeading(page, "עד כמה זה דחוף?")).toBeVisible();
    expect(await fits(lastAnswer()), "urgency").toBe(true);
    await wizard(page).getByText("בחודשים הקרובים", { exact: true }).tap();
    await expect(stepHeading(page, "איך דורית תחזור אליך?")).toBeVisible();
    expect(await fits(wizard(page).getByRole("button", { name: /שליחה לדורית/ })), "contact").toBe(true);
  });

  test("the questionnaire from the keyboard: arrows move between answers without leaving the step", async ({ page }) => {
    await gotoHome(page);
    const concerns = wizard(page).getByRole("group", { name: "מה הכי מעסיק אותך כרגע?" });

    await test_step("arrow keys walk the answers, choosing as they go, and stay on the step", async () => {
      await concerns.getByRole("radio").first().focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(500);
      await expect(stepHeading(page, "מה הכי מעסיק אותך כרגע?")).toBeVisible();
      await expect(concerns.getByRole("radio", { checked: true })).toHaveCount(1);
    });

    await test_step("Enter on the chosen answer moves on, and the step is reported", async () => {
      await page.keyboard.press("Enter");
      await expect(stepHeading(page, "איפה את/ה בחיים כרגע?")).toBeVisible();
      expect(await stepEvents(page)).toEqual(["step_1"]);
    });
  });

  test("common questions: a link to /faq in place of the questions (the Short home page, 2026-10-19)", async ({ page }) => {
    await gotoHome(page);
    const section = page.locator("#common-questions");
    await expect(section.locator("button[aria-expanded]")).toHaveCount(0);
    await section.getByRole("link", { name: "לכל השאלות" }).click();
    await expect(page).toHaveURL(/\/faq$/);
  });
  test("the footer: the menu folded into ניווט באתר, contact two to a row, the licence line in view", async ({ page }) => {
    await gotoHome(page);
    const footer = page.locator("footer");
    await footer.scrollIntoViewIfNeeded();

    await test_step("the menu is a closed <details>, and opening it shows the links", async () => {
      const summary = footer.locator("details > summary");
      await expect(summary).toHaveText("ניווט באתר");
      await expect(footer.getByRole("link", { name: "מדריך תביעות" })).toBeHidden();
      await summary.click();
      await expect(footer.locator("details")).toHaveAttribute("open", "");
      await expect(footer.getByRole("link", { name: "מדריך תביעות" })).toBeVisible();
    });

    await test_step("phone and WhatsApp share a row", async () => {
      const phone = (await footer.getByRole("link", { name: "050-831-1776" }).boundingBox())!;
      const wa = (await footer.getByRole("link", { name: "WhatsApp" }).boundingBox())!;
      expect(Math.abs(phone.y - wa.y)).toBeLessThanOrEqual(2);
      expect(phone.height).toBeGreaterThanOrEqual(44);
    });

    await test_step("the licence line is shown in full", async () => {
      await expect(footer.getByText(/רישיון סוכן מרשות שוק ההון מספר/)).toBeVisible();
      await expect(footer.getByText("L-00107009")).toBeVisible();
    });
  });

  test("the footer: no quote band and no name or slogan — the header has both — with the licence, contact and legal links in view", async ({ page }) => {
    await gotoHome(page);
    const footer = page.locator("footer");
    await footer.scrollIntoViewIfNeeded();

    await test_step("the quote and the repeated name and slogan are hidden, each still there once", async () => {
      for (const text of [/ביטחון אמיתי מתחיל/, "— דורית גוב ארי", "התכנון שלי — השקט שלך"]) {
        const el = footer.getByText(text);
        await expect(el).toHaveCount(1);
        await expect(el).toBeHidden();
      }
    });

    await test_step("what she does, the licence line, contact, the legal links and the copyright are in view", async () => {
      await expect(footer.getByText(/שיווק פנסיוני ותכנון פיננסי/)).toBeVisible();
      await expect(footer.getByText(/רישיון סוכן מרשות שוק ההון מספר/)).toBeVisible();
      await expect(footer.getByRole("link", { name: "050-831-1776" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "WhatsApp" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "מדיניות פרטיות" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "הצהרת נגישות" })).toBeVisible();
      await expect(footer.getByText(/כל הזכויות שמורות/)).toBeVisible();
    });
  });

  test("the home sections below the hero pad 40px top and bottom", async ({ page }) => {
    await gotoHome(page);
    // Testimonials arrive after the route commits; wait for the section.
    await expect(page.locator("#testimonials article")).toHaveCount(2);
    // Each section's content box: the first child of the <section>.
    const paddings = await page.evaluate(() =>
      ["#about", "#services", "#start", "#testimonials", "#common-questions"].map((id) => {
        const box = document.querySelector(`${id} > div`)!;
        const s = getComputedStyle(box);
        return { id, top: parseFloat(s.paddingTop), bottom: parseFloat(s.paddingBottom) };
      }),
    );
    for (const p of paddings) {
      expect(p, p.id).toEqual({ id: p.id, top: 40, bottom: 40 });
    }
  });

  test("testimonials: one card at a time, sideways, with prev and next — and nothing moves by itself", async ({ page }) => {
    await gotoHome(page);
    const section = page.locator("#testimonials");
    await section.scrollIntoViewIfNeeded();
    const strip = section.getByRole("region", { name: "לקוחות מספרים — גלילה אופקית" });
    const cards = strip.locator("article");
    const prev = section.getByRole("button", { name: "ההמלצה הקודמת" });
    const next = section.getByRole("button", { name: "ההמלצה הבאה" });

    await test_step("both cards on one row, in a strip that snaps and scrolls inside itself; the first in view", async () => {
      await expect(cards).toHaveCount(2);
      const tops = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      expect(new Set(tops).size).toBe(1);
      const { scrollWidth, clientWidth, overflowX, snap } = await strip.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        overflowX: getComputedStyle(el).overflowX,
        snap: getComputedStyle(el).scrollSnapType,
      }));
      expect(scrollWidth).toBeGreaterThan(clientWidth);
      expect(overflowX).toBe("auto");
      expect(snap).toContain("mandatory");
      await expect(strip).toHaveAttribute("tabindex", "0");
      await expect(cards.first()).toBeInViewport({ ratio: 0.9 });
      await expect(cards.nth(1)).not.toBeInViewport({ ratio: 0.5 });
      await expect(prev).toHaveAttribute("aria-disabled", "true");
      await expect(next).toHaveAttribute("aria-disabled", "false");
    });

    await test_step("nothing moves on its own", async () => {
      const before = await strip.evaluate((el) => el.scrollLeft);
      await page.waitForTimeout(1500);
      expect(await strip.evaluate((el) => el.scrollLeft)).toBe(before);
    });

    await test_step("ההמלצה הבאה, pressed from the keyboard, shows the second", async () => {
      await next.focus();
      await page.keyboard.press("Enter");
      await expect(cards.nth(1)).toBeInViewport({ ratio: 0.9 });
      await expect(next).toHaveAttribute("aria-disabled", "true");
      await expect(prev).toHaveAttribute("aria-disabled", "false");
    });

    await test_step("ההמלצה הקודמת goes back to the first", async () => {
      await prev.click();
      await expect(cards.first()).toBeInViewport({ ratio: 0.9 });
      await expect(prev).toHaveAttribute("aria-disabled", "true");
    });
  });

  test("the home page stays under 5,750px — it was 10,260", async ({ page }) => {
    // 10,260px before stage 3 at 390x844, 6,590 after it, 5,841 after 3b,
    // 5,321 after 3c, 5,483 once the short questionnaire opened on its eight
    // concerns rather than six life stages, and 5,659 with the two-line
    // headline and the cases' two-line stories (2026-10-14; Chromium and
    // WebKit alike). Not the brief's 4.5 screens —
    // see tests/test-plan/07-std-mobile.md for where the rest is — but a
    // regression of a section's worth should fail here.
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoHome(page);

    await test_step("the testimonials are short", async () => {
      // Testimonials arrive after the route commits; wait for the section.
      await expect(page.locator("#testimonials article")).toHaveCount(2);
      // The cases (#proof) left the page with the Short take (2026-10-19).
      const testimonials = (await page.locator("#testimonials").boundingBox())!.height;
      expect(testimonials, "#testimonials was 791px").toBeLessThan(480);
    });

    await test_step("so are the common questions and the footer", async () => {
      const questions = (await page.locator("#common-questions").boundingBox())!.height;
      const footer = (await page.locator("footer").boundingBox())!.height;
      expect(questions, "#common-questions was 767px").toBeLessThan(700);
      expect(footer, "the footer was 828px").toBeLessThan(600);
    });

    await test_step("and so is the page", async () => {
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      expect(height).toBeLessThan(5750);
    });
  });
});

/** The same page from md up: what stage 3 must not have touched. */
test.describe("Home on a desktop", { tag: "@desktop-only" }, () => {
  test("keeps its portrait, its open services, its standing form, its testimonials grid and its open footer menu", async ({ page }) => {
    await gotoApp(page);

    await test_step("the hero's portrait is the plate, not a circle, and no extra buttons", async () => {
      const plate = (await page.locator("#top figure .plate").boundingBox())!;
      expect(plate.height).toBeGreaterThan(300);
      await expect(page.locator("#top").getByRole("link", { name: "חיוג" })).toBeHidden();
      await expect(page.locator("#top").getByRole("link", { name: "לצפייה בשירותים" })).toBeVisible();
    });

    await test_step("the five services are open rows, with no accordion buttons", async () => {
      // A glossary term is a button with aria-expanded too; it is not an accordion.
      await expect(page.locator("#services button[aria-expanded]:not([data-term])")).toHaveCount(0);
      await expect(page.locator("#services").getByText(/ליווי צמוד ברגע האמת/)).toBeVisible();
    });

    await test_step("the form stands open, the tiles and the chat link are there, the chips are not", async () => {
      await expect(page.locator("#qc-name")).toBeVisible();
      await expect(page.getByRole("link", { name: "עדיף לי בוואטסאפ" })).toBeVisible();
      await expect(page.getByRole("button", { name: /לשיחה עם העוזר/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "השארת פרטים" })).toBeHidden();
    });

    await test_step("a chosen answer moves on, on the desktop too (2026-10-14)", async () => {
      await page.locator("#interview").getByText("מס / החזר מס", { exact: true }).click();
      await expect(page.locator("#interview").getByRole("heading", { name: "איפה את/ה בחיים כרגע?" })).toBeVisible();
    });

    await test_step("the testimonials stand in a grid", async () => {
      await expect(page.locator("#testimonials article")).toHaveCount(2);
      await expect(page.locator("#testimonials").getByRole("button", { name: /ההמלצה/ })).toHaveCount(0);
      await expect(page.locator("#testimonials").getByRole("region")).toHaveCount(0);
    });

    await test_step("the common questions are a link to /faq, and the footer menu is open", async () => {
      await expect(page.locator("#common-questions").getByRole("link", { name: "לכל השאלות" })).toBeVisible();
      await expect(page.locator("footer details")).toHaveCount(0);
      await expect(page.locator("footer").getByRole("link", { name: "מדריך תביעות" })).toBeVisible();
    });

    await test_step("the footer keeps its quote, name and slogan", async () => {
      const footer = page.locator("footer");
      await expect(footer.getByText(/ביטחון אמיתי מתחיל/)).toBeVisible();
      await expect(footer.getByText("התכנון שלי — השקט שלך")).toBeVisible();
    });
  });
});
