import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `@/services` is a light front: each port loads the composition root — and
 * with it both SDKs — on its first real call. These pin the three ways that can
 * go wrong without anything else noticing: a chat subscription that outlives
 * the component that asked for it, one failed chunk download poisoning every
 * later call, and the per-page auth probe quietly loading the SDKs anyway.
 */

vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

type Deferred = { promise: Promise<void>; resolve: () => void };
const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

/** A fake composition root that counts how often it was loaded. */
function fakeRoot(options: { gate?: Promise<void>; failFirst?: boolean } = {}) {
  const state = { loads: 0, subscribe: vi.fn(), unsubscribe: vi.fn(), submitLead: vi.fn(async () => ({ ok: true })) };
  state.subscribe.mockImplementation(() => state.unsubscribe);
  vi.doMock("@/services/composition", async () => {
    state.loads += 1;
    if (options.failFirst && state.loads === 1) throw new Error("Failed to fetch dynamically imported module");
    await options.gate;
    return {
      services: {
        agents: { subscribe: state.subscribe },
        leads: { submitLead: state.submitLead },
        auth: { me: vi.fn(async () => null) },
      },
    };
  });
  return state;
}

async function loadFront() {
  return (await import("@/services")).services;
}

/** Let pending microtasks (the dynamic import and its `.then`s) settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/services/composition");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("agents.subscribe", () => {
  it("never subscribes when the caller unsubscribed before the SDKs arrived", async () => {
    const gate = deferred();
    const root = fakeRoot({ gate: gate.promise });
    const services = await loadFront();

    const unsubscribe = services.agents.subscribe("conv-1", () => {});
    unsubscribe(); // the chat closed while the chunk was still downloading
    gate.resolve();
    await settle();

    expect(root.subscribe).not.toHaveBeenCalled();
  });

  it("subscribes once loaded, and its unsubscribe reaches the real one", async () => {
    const root = fakeRoot();
    const services = await loadFront();

    const unsubscribe = services.agents.subscribe("conv-1", () => {});
    await settle();
    expect(root.subscribe).toHaveBeenCalledWith("conv-1", expect.any(Function));

    unsubscribe();
    expect(root.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("a failed chunk load", () => {
  it("fails that call, and the next call loads again rather than repeating the failure", async () => {
    const root = fakeRoot({ failFirst: true });
    const services = await loadFront();

    // (Vitest wraps an error thrown by a mock factory in a message of its own.)
    await expect(services.leads.submitLead({ name: "a", phone: "050" } as never)).rejects.toThrow();
    await expect(services.leads.submitLead({ name: "a", phone: "050" } as never)).resolves.toEqual({ ok: true });
    expect(root.loads).toBe(2);
    expect(root.submitLead).toHaveBeenCalledTimes(1);
  });

  it("loads once for many concurrent first calls", async () => {
    const root = fakeRoot();
    const services = await loadFront();
    await Promise.all([1, 2, 3].map(() => services.leads.submitLead({ name: "a", phone: "050" } as never)));
    expect(root.loads).toBe(1);
  });
});

describe("a void action whose load fails", () => {
  it("tells the visitor, rather than leaving the button doing nothing", async () => {
    // logout, the sign-in redirects and Google sign-in return nothing to await,
    // so a failed chunk load had no caller to reach — only the console.
    const toast = vi.fn();
    vi.doMock("@/components/ui/use-toast", () => ({ toast }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    fakeRoot({ failFirst: true });
    const services = await loadFront();

    services.auth.logout();
    await settle();
    await settle();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ variant: "destructive" });
    expect(String(toast.mock.calls[0][0].title)).toMatch(/לא הצלחנו/);
    vi.doUnmock("@/components/ui/use-toast");
  });
});

describe("what every page load asks, without the SDKs", () => {
  it("answers hasStoredToken and getPublicSettings without loading the composition root", async () => {
    const root = fakeRoot();
    const services = await loadFront();

    expect(services.auth.hasStoredToken()).toBe(false);
    await expect(services.auth.getPublicSettings()).resolves.toEqual({});
    await settle();
    expect(root.loads).toBe(0);
  });

  it("finds a stored Supabase session without loading the SDK", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project-ref.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const root = fakeRoot();
    const store = new Map([["sb-project-ref-auth-token", JSON.stringify({ access_token: "t" })]]);
    vi.stubGlobal("window", {
      location: { hash: "", search: "" },
      localStorage: {
        get length() {
          return store.size;
        },
        key: (i: number) => [...store.keys()][i] ?? null,
        getItem: (k: string) => store.get(k) ?? null,
      },
    });
    const services = await loadFront();

    expect(services.auth.hasStoredToken()).toBe(true);
    await settle();
    expect(root.loads).toBe(0);
    vi.unstubAllGlobals();
  });
});

describe("the clearinghouse port", () => {
  it("loads the composition root on its first call and delegates to it", async () => {
    const myRole = vi.fn(async () => "staff");
    vi.doMock("@/services/composition", async () => ({ services: { masleka: { myRole } } }));
    const services = await loadFront();
    await expect(services.masleka.myRole()).resolves.toBe("staff");
    expect(myRole).toHaveBeenCalledTimes(1);
  });
});
