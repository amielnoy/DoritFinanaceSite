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
  // `auto` so every spec is stubbed even when it never touches the fixture —
  // an un-stubbed spec would otherwise hit vite preview and 404 on /api.
  mockApi: [async ({ page }, use) => {
    const requests: CapturedRequest[] = [];
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
    await page.route(/fonts\.googleapis\.com/, (route) =>
      route.fulfill({ status: 200, contentType: "text/css", body: "" })
    );
    await page.route(/fonts\.gstatic\.com/, (route) => route.abort());
    await page.route(/media\.base44\.com|base44\.com\/logo/, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG })
    );

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

/** Waits for the app shell to have booted past the bootstrap spinner. */
export async function gotoApp(page: Page, path = "/"): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#root")).not.toBeEmpty();
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
