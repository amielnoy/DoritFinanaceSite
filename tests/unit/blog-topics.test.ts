import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FEATURED,
  TOPICS,
  actionMinutes,
  isFeaturedLive,
  topicCounts,
  topicOf,
} from "@/config/blog-topics";

describe("topicOf", () => {
  it("takes the article's own first tag that names a topic", () => {
    expect(topicOf("מיסוי, עצמאים, פנסיה, גמל והשתלמות, סוף שנה")).toBe("tax");
    expect(topicOf("ביטוח, פנסיה, אובדן כושר עבודה")).toBe("insurance");
    expect(topicOf("פנסיה, פיצויים, מיסוי")).toBe("pension");
  });

  it("skips tags that name no topic", () => {
    expect(topicOf("התנהלות שוטפת, פנסיה, גמל והשתלמות")).toBe("pension");
    expect(topicOf("בריאות, ביטוח, דיגיטל")).toBe("insurance");
  });

  it("counts תכנון פיננסי as family only when nothing else matches", () => {
    expect(topicOf("תכנון פיננסי, ביטוח, פנסיה, ילדים")).toBe("insurance");
    expect(topicOf("תכנון פיננסי, התנהלות שוטפת")).toBe("family");
  });

  it("puts a family tag first in family", () => {
    expect(topicOf("חיסכון, ילדים, גמל והשתלמות, תכנון פיננסי")).toBe("family");
  });

  it("returns null for an article with no topical tag", () => {
    expect(topicOf("התנהלות שוטפת, דיגיטל")).toBeNull();
    expect(topicOf("")).toBeNull();
    expect(topicOf(undefined)).toBeNull();
  });

  it("ignores spacing around tags", () => {
    expect(topicOf("  ביטוח  ,פנסיה")).toBe("insurance");
  });
});

describe("topicCounts", () => {
  it("counts every post under 'all' and each post under its own topic", () => {
    const counts = topicCounts([
      { tags: "פנסיה" },
      { tags: "ביטוח" },
      { tags: "מיסוי" },
      { tags: "פנסיה, ביטוח" },
      { tags: "דיגיטל" },
    ]);
    expect(counts).toEqual({ all: 5, pension: 2, insurance: 1, family: 0, tax: 1 });
  });

  it("offers the five topics in the page's order", () => {
    expect(TOPICS.map((t) => t.label)).toEqual([
      "הכל",
      "פנסיה וגמל",
      "ביטוח",
      "משפחה ואירועי חיים",
      "מיסוי ועצמאים",
    ]);
  });
});

describe("actionMinutes", () => {
  it("reads the action times the articles use", () => {
    expect(actionMinutes("2 דקות")).toBe(2);
    expect(actionMinutes("10 דקות")).toBe(10);
    expect(actionMinutes("רבע שעה")).toBe(15);
    expect(actionMinutes("חצי שעה")).toBe(30);
    expect(actionMinutes("שעה")).toBe(60);
    expect(actionMinutes("ערב אחד")).toBe(180);
    expect(actionMinutes("חודש ראשון")).toBe(30 * 24 * 60);
  });

  it("puts an empty or unreadable time last rather than first", () => {
    expect(actionMinutes(undefined)).toBe(Infinity);
    expect(actionMinutes("")).toBe(Infinity);
    expect(actionMinutes("לפי הצורך")).toBe(Infinity);
  });
});

describe("FEATURED", () => {
  it("is live through the last day, in Israel time", () => {
    expect(FEATURED.until).toBe("2026-12-31");
    expect(isFeaturedLive(new Date("2026-12-31T21:59:00Z"))).toBe(true); // 23:59 in Israel
    expect(isFeaturedLive(new Date("2026-12-31T22:00:00Z"))).toBe(false); // 00:00 on 1 Jan
    expect(isFeaturedLive(new Date("2026-10-10T12:00:00Z"))).toBe(true);
  });

  it("names an article that exists in content/blog", () => {
    const dir = join(process.cwd(), "content/blog");
    const titles = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => readFileSync(join(dir, f), "utf8").match(/^title:\s*"(.*)"$/m)?.[1]);
    expect(titles).toContain(FEATURED.title);
  });
});

describe("the repo's articles", () => {
  it("each land in a topic", () => {
    const dir = join(process.cwd(), "content/blog");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const tags = readFileSync(join(dir, f), "utf8").match(/^tags:\s*"(.*)"$/m)?.[1];
      expect(topicOf(tags), f).not.toBeNull();
    }
  });
});
