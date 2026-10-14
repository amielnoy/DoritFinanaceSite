import { test as base, expect, type Page, type Route } from "@playwright/test";
import { BLOG_POSTS, PUBLIC_SETTINGS, TESTIMONIALS } from "./data";

export interface CapturedRequest {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockApi {
  /** Every /api call the page made, in order. */
  readonly requests: CapturedRequest[];
  /** Replace the rows returned for an entity list/filter. */
  setEntity(name: string, rows: unknown[]): void;
  /** Replace the row returned by Entity.get(id). */
  setEntityDoc(name: string, id: string, row: unknown): void;
  /** Force a status + payload for the next matching path fragment. */
  failOn(pathFragment: string, status: number, payload?: unknown): void;
  /**
   * Every Supabase Edge function call (`/functions/v1/`) the page made. Kept
   * apart from `requests` because it leaves the origin by design, which the
   * same-origin /api check must not trip over.
   */
  readonly edgeRequests: CapturedRequest[];
  /** Wait until an Edge function call whose path contains the fragment is captured. */
  waitForEdgeRequest(pathFragment: string, timeout?: number): Promise<CapturedRequest>;
  /** Requests whose path contains the fragment. */
  requestsTo(pathFragment: string): CapturedRequest[];
  /** Wait until a request matching the fragment has been captured. */
  waitForRequest(pathFragment: string, timeout?: number): Promise<CapturedRequest>;
}

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * Stubs the whole Base44 HTTP surface plus third-party beacons, so every spec
 * runs offline and deterministically. Specs opt into different data through the
 * `mockApi` fixture.
 */
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
  // an un-stubbed spec would otherwise hit vite preview and 404 on /api.
  mockApi: [async ({ page }, use) => {
    const requests: CapturedRequest[] = [];
    const edgeRequests: CapturedRequest[] = [];
    const entities = new Map<string, unknown[]>([
      ["Testimonial", [...TESTIMONIALS]],
      ["BlogPost", [...BLOG_POSTS]],
      ["Lead", []],
    ]);
    const docs = new Map<string, unknown>();
    const failures = new Map<string, { status: number; payload: unknown }>();

    const json = (route: Route, body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(body),
      });

    // --- third-party: keep the run hermetic -------------------------------
    await page.route(/googletagmanager\.com|google-analytics\.com/, (route) => route.abort());
    // Fonts are self-hosted (public/fonts), so the tests render in the real ones.
    await page.route(/media\.base44\.com|base44\.com\/logo/, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG })
    );

    // --- the Supabase Edge functions --------------------------------------
    // A build with VITE_LEAD_FUNCTIONS=supabase posts leads here, cross-origin,
    // not to /api. Stub and record it so a form submission never reaches a real
    // project (it would create a real lead), and so specs can read the body.
    await page.route("**/functions/v1/**", async (route) => {
      const request = route.request();
      const cors = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "POST, OPTIONS",
      };
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      let body: unknown = null;
      try {
        body = request.postDataJSON();
      } catch {
        body = request.postData();
      }
      edgeRequests.push({
        method: request.method(),
        url: request.url(),
        path: new URL(request.url()).pathname,
        headers: request.headers(),
        body,
      });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify({ ok: true }),
      });
    });

    // --- the Base44 API ---------------------------------------------------
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;

      let body: unknown = null;
      try {
        body = request.postDataJSON();
      } catch {
        body = request.postData();
      }
      requests.push({
        method: request.method(),
        url: request.url(),
        path,
        headers: request.headers(),
        body,
      });

      for (const [fragment, failure] of failures) {
        if (path.includes(fragment)) {
          return json(route, failure.payload ?? { error: "forced failure" }, failure.status);
        }
      }

      // App bootstrap
      if (path.includes("/public-settings/")) return json(route, PUBLIC_SETTINGS);

      // Telemetry injected by the Base44 Vite plugin (analyticsTracker). It
      // fires on navigation and would otherwise hit the unstubbed-endpoint 501.
      if (path.includes("/analytics/")) return json(route, { ok: true });

      // Current user: anonymous by default (the public site never needs one).
      if (path.endsWith("/entities/User/me")) {
        return json(route, { detail: "Not authenticated" }, 401);
      }

      // Entity CRUD: /api/apps/:appId/entities/:Entity[/:id]
      const entityMatch = path.match(/\/entities\/([A-Za-z]\w*)(?:\/([^/]+))?$/);
      if (entityMatch) {
        const [, name, id] = entityMatch;
        const rows = entities.get(name) ?? [];

        if (request.method() === "GET") {
          if (id) {
            const doc = docs.get(`${name}:${id}`) ?? rows.find((r: any) => r?.id === id);
            return doc ? json(route, doc) : json(route, { error: "not found" }, 404);
          }
          const q = url.searchParams.get("q");
          if (!q) return json(route, rows);
          const filter = JSON.parse(q) as Record<string, unknown>;
          return json(
            route,
            rows.filter((r: any) => Object.entries(filter).every(([k, v]) => r?.[k] === v))
          );
        }
        if (request.method() === "POST") {
          const created = { id: `${name.toLowerCase()}-${rows.length + 1}`, created_date: new Date().toISOString(), ...(body as object) };
          entities.set(name, [...rows, created]);
          return json(route, created, 201);
        }
        if (request.method() === "PUT" || request.method() === "PATCH") {
          return json(route, { id, ...(body as object) });
        }
        if (request.method() === "DELETE") return json(route, { ok: true });
      }

      // Core integrations (SendEmail, UploadFile, ...)
      if (path.includes("/integration-endpoints/")) {
        if (path.endsWith("/UploadFile")) return json(route, { file_url: "https://media.base44.com/test/upload.png" });
        return json(route, { status: "sent" });
      }

      // Backend functions. submitLead and submitClaim now own email delivery
      // and the Lead write, so the browser only ever sees this one call.
      if (path.includes("/functions/")) {
        const payload = (body ?? {}) as Record<string, unknown>;
        const fn = path.split("/functions/")[1] ?? "";

        if (["submitLead", "submitClaim", "createConsultationEvent", "createOutlookEvent"].includes(fn)) {
          if (!payload.name || !payload.phone) {
            return json(route, { error: "נדרשים שם וטלפון" }, 400);
          }
        }
        if (fn === "createConsultationEvent") {
          return json(route, {
            ok: true,
            eventId: "evt_1",
            htmlLink: "https://calendar.google.com/event?eid=evt_1",
          });
        }
        if (fn === "createOutlookEvent") return json(route, { ok: true, eventId: "outlook_1" });
        return json(route, { ok: true });
      }

      // Agent conversations. Three LLM chat widgets sit on the home page and
      // open a conversation on first message; the suite never drives a real
      // model, it only needs the transport to stay quiet.
      if (path.includes("/agents/")) {
        if (request.method() === "POST" && path.endsWith("/conversations")) {
          return json(route, { id: "conv_1", messages: [] });
        }
        return json(route, { id: "conv_1", messages: [], status: "idle" });
      }

      // Anything unmodelled: fail loudly rather than silently hanging.
      return json(route, { error: `unstubbed endpoint: ${path}` }, 501);
    });

    const api: MockApi = {
      requests,
      edgeRequests,
      waitForEdgeRequest: async (fragment, timeout = 10_000) => {
        const deadline = Date.now() + timeout;
        for (;;) {
          const hit = edgeRequests.find((r) => r.path.includes(fragment));
          if (hit) return hit;
          if (Date.now() > deadline) {
            throw new Error(
              `No Edge request to "${fragment}" within ${timeout}ms. Saw: ${edgeRequests.map((r) => `${r.method} ${r.path}`).join(", ") || "none"}`
            );
          }
          await new Promise((r) => setTimeout(r, 50));
        }
      },
      setEntity: (name, rows) => entities.set(name, rows),
      setEntityDoc: (name, id, row) => docs.set(`${name}:${id}`, row),
      failOn: (fragment, status, payload) => failures.set(fragment, { status, payload }),
      requestsTo: (fragment) => requests.filter((r) => r.path.includes(fragment)),
      waitForRequest: async (fragment, timeout = 10_000) => {
        const deadline = Date.now() + timeout;
        for (;;) {
          const hit = requests.find((r) => r.path.includes(fragment));
          if (hit) return hit;
          if (Date.now() > deadline) {
            throw new Error(
              `No request to "${fragment}" within ${timeout}ms. Saw: ${requests.map((r) => `${r.method} ${r.path}`).join(", ") || "none"}`
            );
          }
          await new Promise((r) => setTimeout(r, 50));
        }
      },
    };

    await use(api);
  }, { auto: true }],
});

export { expect };
// Re-exported so a spec pulls its test, its expect and its step annotation from
// one place: `import { expect, gotoApp, test, test_step } from "../fixtures/app"`.
export { test_step } from "./steps";

/**
 * The run is pointed at a real deployment — the production smoke job sets
 * PLAYWRIGHT_BASE_URL — rather than at the hermetic build this suite serves.
 *
 * That bundle carries real Supabase settings and talks to Base44 directly, so
 * content never passes through the same-origin /api this fixture stubs: the
 * testimonials and articles come from Supabase, the SDK calls Base44's own
 * host. A test whose premise is "the page asked our stubbed /api for X" cannot
 * hold there and would only time out, so it skips and says why. It still runs
 * on every hermetic CI build; the live probes beside it cover the deployment.
 */
export const AGAINST_A_DEPLOYMENT = Boolean(process.env.PLAYWRIGHT_BASE_URL);

/**
 * Where the build under test posts leads. Against a deployment the smoke step
 * passes the repo variable LEAD_FUNCTIONS as E2E_LEAD_FUNCTIONS; a local build
 * is compiled with VITE_LEAD_FUNCTIONS, normally unset, which means Base44.
 * Mirrors src/config/lead-functions.ts: only the exact value "supabase" counts.
 */
export const LEAD_VIA_SUPABASE =
  (AGAINST_A_DEPLOYMENT ? process.env.E2E_LEAD_FUNCTIONS : process.env.VITE_LEAD_FUNCTIONS) === "supabase";
/** The function the quick-contact form posts to. */
export const LEAD_FUNCTION_PATH = LEAD_VIA_SUPABASE ? "/functions/v1/submit-lead" : "/functions/submitLead";
export const STUBS_UNREACHABLE =
  "against a deployment, content comes from Supabase and Base44 directly; the same-origin /api stubs never see it";

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
    // Stubbed/aborted third-party beacons and the anonymous 401 are expected.
    if (/net::ERR_FAILED|Failed to load resource|401|ERR_BLOCKED/i.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return { errors };
}
