import { test as base, expect, type Page, type Route } from "@playwright/test";
import { CONTACT } from "../../src/config/contact";
import { E2E_SUPABASE_URL } from "../build-env";
import { agency1ContentRows } from "./agency1-seed";
import { BLOG_POSTS, TESTIMONIALS } from "./data";
import { answerRestRead, type FakeAnswer, type Row } from "./supabase-fake";

export type { Row } from "./supabase-fake";

export interface CapturedRequest {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockApi {
  /**
   * Every request the page made to Supabase, in order: table reads
   * (`/rest/v1/`), functions (`/functions/v1/`), storage (`/storage/v1/`) and
   * auth (`/auth/v1/`). Preflights are left out. Against a deployment, only
   * the functions — the one part stubbed there.
   */
  readonly requests: CapturedRequest[];
  /** Replace a table's rows (Supabase row shape — see e2e/fixtures/data.ts). */
  setTable(table: string, rows: Row[]): void;
  /** Add a row to a table, or replace the one with the same `id`. */
  setRow(table: string, row: Row): void;
  /** Answer every request whose path contains the fragment with this status and payload. */
  failOn(pathFragment: string, status: number, payload?: unknown): void;
  /** Requests whose path contains the fragment. */
  requestsTo(pathFragment: string): CapturedRequest[];
  /** Wait until a request whose path contains the fragment has been captured. */
  waitForRequest(pathFragment: string, timeout?: number): Promise<CapturedRequest>;
}

/**
 * The run is pointed at a real deployment — the production smoke job sets
 * PLAYWRIGHT_BASE_URL — rather than at the hermetic build this suite serves.
 *
 * That bundle carries the real Supabase project, so its reads go to the live
 * tables, which this fixture never answers: only the functions are stubbed
 * there, so a form in the smoke files no real lead and sends no real mail. A
 * test whose premise is "the page read our seeded rows" cannot hold there and
 * would only time out, so it skips with STUBS_UNREACHABLE. It still runs on
 * every hermetic build; the live probes (e2e/api/supabase-live.spec.ts) cover
 * the deployment's backend.
 */
export const AGAINST_A_DEPLOYMENT = Boolean(process.env.PLAYWRIGHT_BASE_URL);
export const STUBS_UNREACHABLE =
  "against a deployment, the tables are the live project's; this fixture stubs only its functions there";

/** The host the e2e bundle calls Supabase at — e2e/build-env.ts. Nothing else is answered as Supabase. */
const FAKE_ORIGIN = new URL(E2E_SUPABASE_URL).origin;

/** The site's own Vercel functions (api/). Not Base44, and never stubbed. */
const VERCEL_FUNCTIONS = /^\/api\/(og\/|csp-report(\/|$))/;

/**
 * The one Base44 call left: the SDK's own telemetry. `createClient` in
 * src/api/base44Client.js starts it whenever the composition root loads (a
 * form, a chat, a sign-in), whatever the adapters use, and it reads and writes
 * nothing of the site's. It goes when the SDK does (Base44 cleanup 2, part B) —
 * or sooner, with `analytics: { enabled: false }` on that client. Answered 204
 * and kept apart, so the tripwire below stays exact about everything else.
 */
export const BASE44_SDK_TELEMETRY = /^\/api\/apps\/[^/]+\/analytics\/track\/batch$/;

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

const RID = "e2e-rid";

const bodyOf = (route: Route): unknown => {
  const request = route.request();
  if ((request.headers()["content-type"] ?? "").includes("application/json")) {
    try {
      return request.postDataJSON();
    } catch {
      return request.postData();
    }
  }
  // A file upload: its size is all a spec could want, and the bytes are not text.
  const bytes = request.postDataBuffer();
  return bytes ? { bytes: bytes.length } : null;
};

/**
 * One Edge function's answer, in the shape its adapter reads
 * (src/services/supabase/). Name and phone are checked the way submit-lead and
 * submit-claim check them; nothing else is.
 */
function functionAnswer(name: string, body: Record<string, unknown>, chatTurns: Map<string, number>): FakeAnswer | null {
  switch (name) {
    case "submit-lead":
    case "submit-claim":
      if (!body.name || !body.phone) return { status: 400, body: { error: "נדרשים שם וטלפון", rid: RID } };
      return { status: 200, body: { ok: true, rid: RID, leadId: `lead-${name}`, warnings: [] } };
    case "escalate-to-human":
      return {
        status: 200,
        body: {
          ok: true,
          rid: RID,
          leadId: "lead-escalation",
          recorded: true,
          notified: true,
          reason: body.reason ?? "",
          contact: { phoneDisplay: CONTACT.phoneDisplay, phoneE164: CONTACT.phoneE164, whatsapp: CONTACT.whatsapp, email: CONTACT.email },
          acknowledgement: "הפרטים הועברו לדורית והיא תחזור אישית תוך יום עסקים אחד.",
          warnings: [],
        },
      };
    case "chat": {
      // supabase/functions/chat: one POST per message, the whole reply in the answer.
      const id = String(body.conversationId ?? "");
      if (body.status === true) {
        const turns = chatTurns.get(id) ?? 0;
        return { status: 200, body: { ok: true, rid: RID, busy: false, status: "open", leadSaved: false, turns, last: null } };
      }
      const turn = (chatTurns.get(id) ?? 0) + 1;
      chatTurns.set(id, turn);
      return {
        status: 200,
        body: { ok: true, rid: RID, conversationId: id, turn, reply: "תודה, קיבלתי. (תשובת בדיקה)", leadSaved: false, status: "open" },
      };
    }
    default:
      return null;
  }
}

/**
 * Stubs the backend the e2e bundle talks to — Supabase, at the fake host of
 * e2e/build-env.ts — plus the third-party beacons, so every spec runs offline
 * and deterministically.
 *
 *   /rest/v1/<table>       reads, over the tables seeded here (supabase-fake.ts)
 *   /functions/v1/<name>   recorded, and answered per function (functionAnswer)
 *   /storage/v1/object/…   an upload is stored, a public image is a 1×1 PNG
 *   /auth/v1/user          401: the visitor is anonymous
 *
 * Anything else on the fake host answers 501, and any `/api/` request that is
 * not one of the site's own Vercel functions (or the SDK's telemetry, above)
 * answers 501 too — that is the Base44 path the bundle no longer takes. Both
 * fail the test when it ends.
 *
 * Exported for a spec that opens its own context (seo/mobile-parity.spec.ts).
 */
export async function stubBackend(page: Page): Promise<MockApi & { readonly unmodelled: string[] }> {
  const requests: CapturedRequest[] = [];
  const unmodelled: string[] = [];
  const tables = new Map<string, Row[]>([
    ["testimonials", [...TESTIMONIALS]],
    ["blog_posts", [...BLOG_POSTS]],
    // Read only by a signed-in admin; seeded empty so a stray read is visible, not a 404.
    ["leads", []],
    // Agency 1's site, agent card and success cases, as the seed migration
    // writes them: VITE_AGENCY_CONTENT is on in the e2e build (build-env.ts).
    ...agency1ContentRows(),
  ]);
  const failures = new Map<string, { status: number; payload: unknown }>();
  const chatTurns = new Map<string, number>();

  const fulfill = (route: Route, answer: FakeAnswer) =>
    route.fulfill({
      status: answer.status,
      contentType: "application/json",
      headers: { ...CORS, ...answer.headers },
      body: JSON.stringify(answer.body),
    });

  // --- third-party: keep the run hermetic -------------------------------
  await page.route(/googletagmanager\.com|google-analytics\.com/, (route) => route.abort());
  // Fonts are self-hosted (public/fonts), so the tests render in the real ones.

  // --- the tripwire: nothing reaches Base44 -------------------------------
  // The bundle reads and writes Supabase; a request here is a regression to the
  // Base44 path, answered 501 and failed at the end of the test.
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (VERCEL_FUNCTIONS.test(url.pathname)) return route.fallback();
    if (BASE44_SDK_TELEMETRY.test(url.pathname)) return route.fulfill({ status: 204, headers: CORS });
    unmodelled.push(`${route.request().method()} ${url.origin}${url.pathname} (Base44 /api)`);
    return fulfill(route, { status: 501, body: { error: `unstubbed: ${url.pathname} — the e2e bundle must not reach Base44` } });
  });

  // --- Supabase ----------------------------------------------------------
  // Hermetic: everything on the fake host. Against a deployment the bundle
  // calls the real host, and only its functions are taken here — its reads
  // stay live, and this route cannot swallow them.
  await page.route(
    (url) => url.origin === FAKE_ORIGIN || url.pathname.startsWith("/functions/v1/"),
    async (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const url = new URL(request.url());
      const path = url.pathname;
      const body = bodyOf(route);
      requests.push({ method: request.method(), url: request.url(), path, headers: request.headers(), body });

      for (const [fragment, failure] of failures) {
        if (path.includes(fragment)) {
          return fulfill(route, { status: failure.status, body: failure.payload ?? { error: "forced failure", rid: RID } });
        }
      }

      const fn = /^\/functions\/v1\/([^/]+)$/.exec(path)?.[1];
      if (fn) {
        const answer = functionAnswer(fn, (body ?? {}) as Record<string, unknown>, chatTurns);
        if (answer) return fulfill(route, answer);
      } else if (path.startsWith("/rest/v1/") && request.method() === "GET") {
        const answer = answerRestRead(url, tables);
        // An unseeded table or a filter outside the subset: the fake's gap, not the page's error state.
        if (answer.status >= 400) unmodelled.push(`GET ${path}${url.search} — ${(answer.body as { message?: string }).message}`);
        return fulfill(route, answer);
      } else if (path.startsWith("/storage/v1/object/public/") && request.method() === "GET") {
        return route.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: TRANSPARENT_PNG });
      } else if (path.startsWith("/storage/v1/object/") && ["POST", "PUT"].includes(request.method())) {
        // storage-js reads `Key` (bucket/path) and `Id`.
        const key = path.slice("/storage/v1/object/".length);
        return fulfill(route, { status: 200, body: { Key: key, Id: "00000000-0000-4000-8000-0000000000f1" } });
      } else if (path === "/auth/v1/user") {
        return fulfill(route, { status: 401, body: { code: 401, error_code: "no_authorization", msg: "This endpoint requires a valid Bearer token" } });
      }

      unmodelled.push(`${request.method()} ${path}`);
      return fulfill(route, { status: 501, body: { error: `unstubbed Supabase endpoint in the e2e fake: ${request.method()} ${path}` } });
    },
  );

  const waitForRequest = async (fragment: string, timeout = 10_000): Promise<CapturedRequest> => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const hit = requests.find((r) => r.path.includes(fragment));
      if (hit) return hit;
      if (Date.now() > deadline) {
        throw new Error(
          `No request to "${fragment}" within ${timeout}ms. Saw: ${requests.map((r) => `${r.method} ${r.path}`).join(", ") || "none"}`,
        );
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  return {
    requests,
    unmodelled,
    setTable: (table, rows) => void tables.set(table, [...rows]),
    setRow: (table, row) => {
      const rows = (tables.get(table) ?? []).filter((r) => r.id !== row.id);
      tables.set(table, [...rows, row]);
    },
    failOn: (fragment, status, payload) => void failures.set(fragment, { status, payload }),
    requestsTo: (fragment) => requests.filter((r) => r.path.includes(fragment)),
    waitForRequest,
  };
}

export const test = base.extend<{ mockApi: MockApi }>({
  // Every `request.get/head/fetch` retries a connection reset twice. Under a
  // full parallel run, vite preview has reset a reused keep-alive socket on a
  // test's first GET (ECONNRESET, mobile-parity fonts, 2026-10-13). maxRetries
  // retries exactly that — network errors, today only ECONNRESET — and never an
  // HTTP status, so no assertion about a response can be retried away. A spec
  // that passes its own maxRetries keeps it.
  request: async ({ request }, use) => {
    const retried = new Set<PropertyKey>(["get", "head", "fetch"]);
    await use(
      new Proxy(request, {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop, target);
          if (typeof value !== "function") return value;
          if (!retried.has(prop)) return value.bind(target);
          return (url: unknown, options: object = {}) => value.call(target, url, { maxRetries: 2, ...options });
        },
      }),
    );
  },

  // `auto` so every spec is stubbed even when it never touches the fixture —
  // an un-stubbed spec would otherwise send the bundle's reads to a host that
  // does not resolve, and render error states nobody asked for.
  mockApi: [async ({ page }, use) => {
    const api = await stubBackend(page);
    await use(api);
    // The tripwire's verdict. Against a deployment the bundle is production's,
    // not this suite's, so it is not this suite's to judge.
    if (!AGAINST_A_DEPLOYMENT) {
      expect(
        api.unmodelled,
        "requests the e2e backend does not model — a Base44 /api call, or a Supabase table, function or route " +
          "e2e/fixtures/app.ts does not answer. Model it, or find out why the page made it.",
      ).toEqual([]);
    }
  }, { auto: true }],
});

export { expect };
// Re-exported so a spec pulls its test, its expect and its step annotation from
// one place: `import { expect, gotoApp, test, test_step } from "../fixtures/app"`.
export { test_step } from "./steps";

/**
 * Waits until React has committed the current route over whatever the server
 * sent: src/components/RouteCommitted.tsx sets `<html data-route-committed>` to
 * the path once the route's real content (or its error screen) is live.
 *
 * "#root is not empty" used to stand in for this, and stopped meaning anything
 * once pages were prerendered: #root is full before any JavaScript runs, and
 * createRoot throws that markup away on its first commit. A test that scrolled,
 * clicked or read state in between acted on a page about to vanish — "Element
 * is not attached to the DOM", taps that did nothing, a token not yet wiped.
 *
 * 20s, not the 10s expect timeout: WebKit has measured boots past 10s under CI
 * contention (see the `workers` note in playwright.config.ts).
 */
export async function waitForAppLive(page: Page, timeout = 20_000): Promise<void> {
  // A bare waitForFunction timeout says nothing. The two ways to get here are
  // an app that threw before its first commit and a target built before the
  // marker existed, so name what was seen.
  const pageErrors: string[] = [];
  const onPageError = (e: Error) => pageErrors.push(e.message);
  page.on("pageerror", onPageError);
  try {
    await page.waitForFunction(
      () => document.documentElement.dataset.routeCommitted === window.location.pathname,
      undefined,
      { timeout },
    );
  } catch (cause) {
    const seen = await page
      .evaluate(() => ({ path: window.location.pathname, marker: document.documentElement.dataset.routeCommitted ?? null }))
      .catch(() => null);
    throw new Error(
      [
        `the app never went live on ${seen?.path ?? page.url()} within ${timeout}ms`,
        `(data-route-committed = ${JSON.stringify(seen?.marker ?? null)}).`,
        pageErrors.length
          ? `Page errors: ${pageErrors.join(" | ")}`
          : "No page error was raised. Is the target built from a commit that has RouteCommitted?",
      ].join(" "),
      { cause },
    );
  } finally {
    page.off("pageerror", onPageError);
  }
}

/** Opens a route and waits for the app to be live on it (see waitForAppLive). */
export async function gotoApp(page: Page, path = "/"): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await waitForAppLive(page);
}

/**
 * Bring the home page's short contact form (#quick-contact) on screen. Below md
 * it waits, folded, behind the "השארת פרטים" chip under the questionnaire
 * (stage 3); from md up it stands open and this only scrolls to it.
 */
export async function openQuickContact(page: Page): Promise<void> {
  const chip = page.locator("#start").getByRole("button", { name: "השארת פרטים" });
  if ((await chip.isVisible()) && (await chip.getAttribute("aria-expanded")) !== "true") {
    await chip.click();
    await expect(chip).toHaveAttribute("aria-expanded", "true");
  }
  await page.locator("#quick-contact").scrollIntoViewIfNeeded();
}

/** Collects page errors and console errors for the lifetime of a test. */
export function collectPageErrors(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Stubbed/aborted third-party beacons, forced failures and the anonymous 401 are expected.
    if (/net::ERR_FAILED|Failed to load resource|401|ERR_BLOCKED/i.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return { errors };
}
