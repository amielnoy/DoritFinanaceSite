import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_SCOPES,
  googleAccessToken,
  googleConfigured,
  resetGoogleTokenCache,
} from "../../supabase/functions/_shared/google";

async function testKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString("base64")}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: pair.publicKey };
}

const b64urlDecode = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

describe("googleAccessToken", () => {
  let env: Record<string, string>;
  let calls: { url: string; body: string }[];
  let key: Awaited<ReturnType<typeof testKey>>;

  beforeEach(async () => {
    resetGoogleTokenCache();
    key = await testKey();
    env = {
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: "leads@project.iam.gserviceaccount.com",
        private_key: key.pem,
        token_uri: "https://oauth2.googleapis.com/token",
      }),
    };
    vi.stubGlobal("Deno", { env: { get: (k: string) => env[k] } });
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ access_token: `tok-${calls.length}`, expires_in: 3600 }), { status: 200 });
    }));
  });

  it("is configured only with a key that has an address and a private key", () => {
    expect(googleConfigured()).toBe(true);
    env.GOOGLE_SERVICE_ACCOUNT_JSON = "{}";
    expect(googleConfigured()).toBe(false);
    env.GOOGLE_SERVICE_ACCOUNT_JSON = "not json";
    expect(googleConfigured()).toBe(false);
  });

  it("exchanges a JWT signed with the key, for exactly the two scopes", async () => {
    expect(await googleAccessToken(Date.UTC(2026, 9, 13, 8))).toBe("tok-1");
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(calls[0].body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [h, p, s] = form.get("assertion")!.split(".");
    expect(JSON.parse(b64urlDecode(h).toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(b64urlDecode(p).toString());
    expect(claims).toMatchObject({
      iss: "leads@project.iam.gserviceaccount.com",
      aud: "https://oauth2.googleapis.com/token",
      scope: GOOGLE_SCOPES.join(" "),
      iat: Date.UTC(2026, 9, 13, 8) / 1000,
      exp: Date.UTC(2026, 9, 13, 8) / 1000 + 3600,
    });
    expect(GOOGLE_SCOPES).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/spreadsheets",
    ]);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key.publicKey,
      b64urlDecode(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok, "signature does not verify with the key's public half").toBe(true);
  });

  it("reuses the token within its hour and renews it five minutes before the end", async () => {
    const t0 = Date.UTC(2026, 9, 13, 8);
    expect(await googleAccessToken(t0)).toBe("tok-1");
    expect(await googleAccessToken(t0 + 54 * 60_000)).toBe("tok-1");
    expect(await googleAccessToken(t0 + 56 * 60_000)).toBe("tok-2");
    expect(calls).toHaveLength(2);
  });

  it("names the failure without the endpoint's words", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"invalid_grant","error_description":"secret stuff"}', { status: 400 })));
    await expect(googleAccessToken()).rejects.toThrow(/^google_token_http_400$/);
    env.GOOGLE_SERVICE_ACCOUNT_JSON = "";
    resetGoogleTokenCache();
    await expect(googleAccessToken()).rejects.toThrow("google_not_configured");
  });
});
