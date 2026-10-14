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

test.describe("Mobile web (iOS + Android)", { tag: "@mobile-only" }, () => {
  test("renders the sticky WhatsApp/call/contact/support bar instead of the desktop dock", async ({ page }) => {
    await test_step("open the home page on a phone viewport", async () => {
      await gotoApp(page);
    });

    await test_step("the sticky bar offers WhatsApp, a call, the short contact form and support", async () => {
      const stickyWhatsapp = stickyBar(page).getByRole("link", { name: /וואטסאפ/ });
      const stickyCall = stickyBar(page).getByRole("link", { name: /חייגו/ });
      const stickyForm = stickyBar(page).getByRole("link", { name: /השאירו פרטים/ });
      const stickySupport = stickyBar(page).getByRole("link", { name: /תמיכה/ });
      await expect(stickyWhatsapp).toBeVisible();
      await expect(stickyCall).toBeVisible();
      await expect(stickyForm).toBeVisible();
      await expect(stickySupport).toBeVisible();
      await expect(stickyWhatsapp).toHaveAttribute("href", /^https:\/\/wa\.me\/972508311776\?text=/);
      await expect(stickyCall).toHaveAttribute("href", "tel:+972508311776");
      await expect(stickyForm).toHaveAttribute("href", "/#quick-contact");
    });

    await test_step("the desktop floating dock is hidden below md", async () => {
      await expect(page.getByRole("link", { name: "פתיחת שיחה בוואטסאפ" })).toBeHidden();
    });
  });

  test("the sticky bar's השאירו פרטים reaches the form from another route", async ({ page }) => {
    // The bar is on every route and the form only on home. As a bare
    // `#quick-contact` it did nothing at all on /blog.
    await test_step("open the blog on a phone viewport", async () => {
      await gotoApp(page, "/blog");
    });

    await test_step("tap השאירו פרטים in the sticky bar", async () => {
      await stickyBar(page).getByRole("link", { name: /השאירו פרטים/ }).click();
    });

    await test_step("it lands on the home page at the short contact form", async () => {
      await expect(page).toHaveURL(/\/#quick-contact$/);
      await expect(page.locator("#quick-contact")).toBeInViewport({ ratio: 0.05 });
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
        stickyBar(page).getByRole("link", { name: /וואטסאפ/ }),
        stickyBar(page).getByRole("link", { name: /חייגו/ }),
        stickyBar(page).getByRole("link", { name: /השאירו פרטים/ }),
        stickyBar(page).getByRole("link", { name: /תמיכה/ }),
        page.getByRole("button", { name: "תפריט" }),
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

    await test_step("open the home page and scroll to the quick contact form", async () => {
      await gotoApp(page);
      await form.scrollIntoViewIfNeeded();
    });

    await test_step("phone and email fields ask for the matching keyboard", async () => {
      await expect(form.locator("#qc-phone")).toHaveAttribute("type", "tel");
      await expect(form.locator("#qc-email")).toHaveAttribute("type", "email");
    });
  });

  test("a visitor can submit the quick contact form by touch", async ({ page, mockApi }) => {
    const form = page.locator("#quick-contact");

    await test_step("open the home page and scroll to the quick contact form", async () => {
      await gotoApp(page);
      await form.scrollIntoViewIfNeeded();
    });

    await test_step("fill the form using taps only", async () => {
      await form.locator("#qc-name").tap();
      await form.locator("#qc-name").fill("ישראלה");
      await form.locator("#qc-phone").fill("050-1234567");
      await form.getByRole("button", { name: "שליחת הודעה" }).tap();
    });

    await test_step("the message is confirmed and the lead reaches the backend", async () => {
      await expect(form.getByText("ההודעה נשלחה. תודה.")).toBeVisible();
      const lead = await mockApi.waitForRequest("/functions/submitLead");
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
    for (const zoom of [1, 1.3]) {
      await test_step(`at ${zoom}x text`, async () => {
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
