/**
 * @vitest-environment jsdom
 *
 * The blog index: topic filter, "show all", the featured row and the
 * recommender box. The reading-recommender's own filtering is covered in
 * blog-recommendation-filter.test.tsx; AgentChat is stubbed here too.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { base44Mock, resetBase44Mock } from "./base44-mock";
import { FEATURED } from "@/config/blog-topics";

if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.mock("@/api/base44Client", () => ({ base44: base44Mock }));
vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

const auth = vi.hoisted(() => ({ isAuthenticated: false, user: null as null | { role: string } }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => auth }));

vi.mock("framer-motion", async () => {
  const R = await import("react");
  const passthrough = new Proxy(
    {},
    { get: (_t, tag: string) => ({ children, ...props }: any) => R.createElement(tag, props, children) },
  );
  return {
    motion: passthrough,
    AnimatePresence: ({ children }: any) => R.createElement(R.Fragment, null, children),
    useReducedMotion: () => true,
  };
});

vi.mock("@/components/dorit/chat/AgentChat", () => ({
  default: (props: { initialInput?: string; embedded?: boolean }) => (
    <div data-testid="agent-chat" data-initial-input={props.initialInput} data-embedded={String(props.embedded)} />
  ),
}));

const post = (id: string, tags: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `מאמר ${id}`,
  excerpt: `תקציר ${id}`,
  body: "א".repeat(2200),
  tags,
  published: true,
  created_date: "2026-10-01T09:00:00Z",
  ...over,
});

/** Twelve posts: more than one page on either width. */
const POSTS = [
  post("tax-1", "מיסוי, עצמאים", { title: FEATURED.title, action_time: "חצי שעה" }),
  post("tax-2", "החזר מס", { action_time: "ערב אחד" }),
  post("ins-1", "ביטוח, משכנתא", { action_time: "רבע שעה" }),
  post("ins-2", "בריאות"),
  post("fam-1", "חיסכון, ילדים", { action_time: "2 דקות" }),
  post("pen-1", "פנסיה", { action_time: "10 דקות" }),
  post("pen-2", "פנסיה"),
  post("pen-3", "פנסיה"),
  post("pen-4", "פנסיה"),
  post("pen-5", "פנסיה"),
  post("pen-6", "פנסיה"),
  post("pen-7", "פנסיה", { image_url: "https://media.base44.com/images/public/test/real.jpg" }),
];

const { default: Blog } = await import("@/pages/Blog");

const renderBlog = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Blog />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

/** The topic buttons render once the posts have loaded. */
const loaded = () => screen.findByRole("group", { name: "סינון לפי נושא" });

const gridIds = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[id^="post-"]')).map((el) => el.id.slice(5));
const topicButton = (name: RegExp) =>
  within(screen.getByRole("group", { name: "סינון לפי נושא" })).getByRole("button", { name });
const featuredRow = () => screen.queryByRole("region", { name: "מומלץ עכשיו" });

beforeEach(() => {
  resetBase44Mock();
  base44Mock.entities.BlogPost.filter.mockResolvedValue(POSTS);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the topic filter", () => {
  it("shows a count per topic and starts on הכל", async () => {
    renderBlog();
    await loaded();
    expect(topicButton(/^הכל/).getAttribute("aria-pressed")).toBe("true");
    expect(topicButton(/^הכל/).textContent).toContain("12");
    expect(topicButton(/^פנסיה וגמל/).textContent).toContain("7");
    expect(topicButton(/^ביטוח/).textContent).toContain("2");
    expect(topicButton(/^משפחה ואירועי חיים/).textContent).toContain("1");
    expect(topicButton(/^מיסוי ועצמאים/).textContent).toContain("2");
  });

  it("narrows the grid to the chosen topic and marks only that button pressed", async () => {
    renderBlog();
    await loaded();

    fireEvent.click(topicButton(/^ביטוח/));

    expect(gridIds()).toEqual(["ins-1", "ins-2"]);
    expect(topicButton(/^ביטוח/).getAttribute("aria-pressed")).toBe("true");
    expect(topicButton(/^הכל/).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("heading", { level: 2, name: /^ביטוח\s*2 מאמרים$/ })).toBeTruthy();
  });

  it("combines with the search box", async () => {
    renderBlog();
    await loaded();
    fireEvent.click(topicButton(/^פנסיה וגמל/));
    fireEvent.change(screen.getByLabelText("חיפוש מאמרים"), { target: { value: "pen-3" } });
    expect(gridIds()).toEqual(["pen-3"]);
  });
});

describe("show all", () => {
  it("shows the first nine, then the rest on request", async () => {
    renderBlog();
    await loaded();
    expect(gridIds()).toHaveLength(9);
    expect(gridIds()).not.toContain("pen-7");

    fireEvent.click(screen.getByRole("button", { name: /^הצגת כל המאמרים/ }));

    expect(gridIds()).toHaveLength(12);
    expect(gridIds()).toContain("pen-7");
    expect(screen.queryByRole("button", { name: /^הצגת כל המאמרים/ })).toBeNull();
  });

  it("hides cards past the sixth on a phone only, with the count a phone sees", async () => {
    renderBlog();
    await loaded();
    const cards = document.querySelectorAll('[id^="post-"]');
    expect(cards[5].className).not.toContain("max-md:hidden");
    expect(cards[6].className).toContain("max-md:hidden");
    const button = screen.getByRole("button", { name: /^הצגת כל המאמרים/ });
    expect(button.textContent).toContain("(6 נוספים)");
    expect(button.textContent).toContain("(3 נוספים)");
  });
});

describe("the featured row", () => {
  it("shows the featured article and the three quickest to act on under הכל", async () => {
    renderBlog();
    await loaded();
    const row = featuredRow()!;
    expect(row).not.toBeNull();
    expect(within(row).getByText(FEATURED.badge)).toBeTruthy();
    expect(within(row).getByRole("heading", { name: FEATURED.title })).toBeTruthy();
    const quickest = within(row).getAllByRole("listitem").map((li) => li.textContent);
    expect(quickest).toEqual([
      expect.stringContaining("ביצוע: 2 דקות"),
      expect.stringContaining("ביצוע: 10 דקות"),
      expect.stringContaining("ביצוע: רבע שעה"),
    ]);
  });

  it("stays under מיסוי ועצמאים and goes away under any other topic", async () => {
    renderBlog();
    await loaded();
    fireEvent.click(topicButton(/^מיסוי ועצמאים/));
    expect(featuredRow()).not.toBeNull();
    fireEvent.click(topicButton(/^ביטוח/));
    expect(featuredRow()).toBeNull();
    fireEvent.click(topicButton(/^פנסיה וגמל/));
    expect(featuredRow()).toBeNull();
  });

  it("is gone once its deadline has passed", async () => {
    vi.setSystemTime(new Date("2027-01-02T10:00:00Z"));
    renderBlog();
    await loaded();
    expect(featuredRow()).toBeNull();
  });

  it("is gone when the featured article is not published", async () => {
    base44Mock.entities.BlogPost.filter.mockResolvedValue(POSTS.slice(1));
    renderBlog();
    await loaded();
    expect(featuredRow()).toBeNull();
  });
});

describe("the cards", () => {
  it("render no image at all when the article has none", async () => {
    renderBlog();
    await loaded();
    expect(document.getElementById("post-ins-1")!.querySelector("img")).toBeNull();
  });

  it("render the article's own image when it has one", async () => {
    renderBlog();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /^הצגת כל המאמרים/ }));
    expect(document.getElementById("post-pen-7")!.querySelector("img")).not.toBeNull();
  });

  it("show the action time when there is one, and the reading time always", async () => {
    renderBlog();
    await loaded();
    const withTime = document.getElementById("post-ins-1")!;
    expect(withTime.textContent).toContain("ביצוע: רבע שעה");
    expect(withTime.textContent).toContain("קריאה: כ־2 דק׳");
    const withoutTime = document.getElementById("post-ins-2")!;
    expect(withoutTime.textContent).not.toContain("ביצוע:");
    expect(withoutTime.textContent).toContain("קריאה: כ־2 דק׳");
  });
});

describe("the recommender box", () => {
  it("opens the reading-recommender chat with what the visitor typed", async () => {
    renderBlog();
    await loaded();
    expect(screen.queryByTestId("agent-chat")).toBeNull();

    fireEvent.change(screen.getByLabelText("ספרו בקצרה מה קרה אצלכם"), { target: { value: "נולד לנו ילד" } });
    fireEvent.click(screen.getByRole("button", { name: "המליצו לי" }));

    const dialog = await screen.findByRole("dialog");
    const chat = within(dialog).getByTestId("agent-chat");
    expect(chat.getAttribute("data-initial-input")).toBe("נולד לנו ילד");
    expect(chat.getAttribute("data-embedded")).toBe("true");
  });

  it("gives the page back to assistive tech once the dialog closes", async () => {
    renderBlog();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "המליצו לי" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("heading", { level: 2, name: /^כל המאמרים/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: /^כל המאמרים/ })).toBeTruthy();
  });

  it("carries the one-line disclosure and the privacy link", async () => {
    renderBlog();
    await loaded();
    expect(screen.getByText(/עוזר אוטומטי של דורית, לא ייעוץ\. אין לכתוב תעודת זהות או מספרי פוליסה\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "מדיניות הפרטיות" }).getAttribute("href")).toBe("/privacy");
  });
});

describe("the contact band", () => {
  it("offers WhatsApp with the blog's own opening line, and the phone", async () => {
    renderBlog();
    await loaded();
    const band = screen.getByRole("region", { name: /קראתם\. רוצים שדורית תבדוק את זה אצלכם\?/ });
    expect(band.getAttribute("data-track-location")).toBe("blog_cta");
    const wa = within(band).getByRole("link", { name: /וואטסאפ/ }).getAttribute("href")!;
    expect(wa).toMatch(/^https:\/\/wa\.me\/972508311776\?text=/);
    expect(decodeURIComponent(wa.split("text=")[1])).toBe("שלום דורית, הגעתי מהבלוג");
    expect(within(band).getByRole("link", { name: /חייגו/ }).getAttribute("href")).toBe("tel:+972508311776");
  });
});
