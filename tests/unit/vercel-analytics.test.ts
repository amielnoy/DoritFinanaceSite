import { describe, expect, it } from "vitest";
import { stripFragment } from "@/lib/vercel-analytics";

const TOKEN = "A".repeat(43);

describe("stripFragment (Vercel Analytics beforeSend)", () => {
  it("drops the #t= token from a /masleka url", () => {
    const out = stripFragment({ type: "pageview", url: `https://govari-fin.co.il/masleka#t=${TOKEN}` });
    expect(out.url).toBe("https://govari-fin.co.il/masleka");
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it("leaves a url without a hash unchanged", () => {
    const out = stripFragment({ type: "pageview", url: "https://govari-fin.co.il/blog" });
    expect(out.url).toBe("https://govari-fin.co.il/blog");
  });

  it("keeps the query and drops only the hash", () => {
    const out = stripFragment({ type: "pageview", url: `https://govari-fin.co.il/masleka?utm=x&a=1#t=${TOKEN}` });
    expect(out.url).toBe("https://govari-fin.co.il/masleka?utm=x&a=1");
  });
});
