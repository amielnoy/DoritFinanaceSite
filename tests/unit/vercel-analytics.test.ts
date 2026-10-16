import { describe, expect, it } from "vitest";
import { stripFragment } from "@/lib/vercel-analytics";

const TOKEN = "A".repeat(43);

describe("stripFragment (Vercel Analytics beforeSend)", () => {
  it("drops the #t= token from a /masleka url", () => {
    const out = stripFragment({ type: "pageview", url: `https://govari-fin.co.il/masleka#t=${TOKEN}` });
    expect(out?.url).toBe("https://govari-fin.co.il/masleka");
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it("leaves a url without a hash unchanged", () => {
    const out = stripFragment({ type: "pageview", url: "https://govari-fin.co.il/blog" });
    expect(out?.url).toBe("https://govari-fin.co.il/blog");
  });

  it("keeps the query and drops only the hash", () => {
    const out = stripFragment({ type: "pageview", url: `https://govari-fin.co.il/masleka?utm=x&a=1#t=${TOKEN}` });
    expect(out?.url).toBe("https://govari-fin.co.il/masleka?utm=x&a=1");
  });

  it.each(['/admin', '/admin/', '/admin/users?q=alice%40example.com', '/admin/masleka/analysis/123'])('ignores private admin events at %s', (path) => {
    expect(stripFragment({ type: 'pageview', url: `https://govari-fin.co.il${path}` })).toBeNull();
    expect(stripFragment({ type: 'event', name: 'click', url: `https://govari-fin.co.il${path}` })).toBeNull();
  });

  it('removes free-text search while preserving public campaign parameters', () => {
    const out = stripFragment({ type: 'pageview', url: 'https://govari-fin.co.il/blog?q=alice%40example.com&utm_source=email#section' });
    expect(out?.url).toBe('https://govari-fin.co.il/blog?utm_source=email');
  });

  it('drops malformed URLs instead of passing them through', () => {
    expect(stripFragment({ type: 'pageview', url: 'invalid?q=alice@example.com' })).toBeNull();
  });
});
