/**
 * @vitest-environment jsdom
 *
 * The admin article form's address field: prefilled for an existing article,
 * refused unless it can be one, and a warning before a published article's
 * address changes (there is no redirect table — the old address will 404).
 * The hooks are stubbed; the writes are contentAdmin's, covered in
 * tests/integration/content-admin.integration.test.ts.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SLUG_PROBLEMS, SLUG_TAKEN } from "@/lib/articlePath";

const h = vi.hoisted(() => ({
  articles: [
    {
      id: "64f0a1b2c3d4e5f6a7b8c9d0",
      slug: "horadat-dmei-nihul",
      title: "להוריד דמי ניהול",
      body: "גוף",
      published: true,
      created_date: "2026-10-01T09:00:00Z",
    },
    {
      id: "64f0a1b2c3d4e5f6a7b8c9d1",
      slug: "mutavim",
      title: "מוטבים",
      body: "גוף",
      published: false,
      created_date: "2026-10-02T09:00:00Z",
    },
    {
      id: "64f0a1b2c3d4e5f6a7b8c9d2",
      slug: "post-6ac8eb62b0a953274445869d",
      title: "ישן עם כתובת חלופית",
      body: "גוף",
      published: true,
      created_date: "2026-09-01T09:00:00Z",
    },
    {
      id: "64f0a1b2c3d4e5f6a7b8c9d3",
      title: "ישן בלי כתובת",
      body: "גוף",
      published: false,
      created_date: "2026-09-02T09:00:00Z",
    },
  ],
  save: vi.fn(async (_args: unknown) => {}),
}));

vi.mock("@/hooks/useAdmin", () => ({
  useAdminArticles: () => ({ data: h.articles, isPending: false, isError: false }),
  useSaveArticle: () => ({ mutateAsync: h.save, isPending: false }),
  useSetArticlePublished: () => ({ mutate: vi.fn(), isError: false }),
  useRemoveArticle: () => ({ mutate: vi.fn(), isError: false }),
}));
vi.mock("@/services", () => ({ services: { uploads: { upload: vi.fn() } } }));

const { default: BlogAdmin } = await import("@/pages/BlogAdmin");

const renderAdmin = () =>
  render(
    <MemoryRouter>
      <BlogAdmin />
    </MemoryRouter>,
  );
const slugInput = () => screen.getByLabelText(/כתובת המאמר/) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: /שמירה/ }) as HTMLButtonElement;
const edit = (i: number) => fireEvent.click(screen.getAllByRole("button", { name: "עריכה" })[i]);
const typeSlug = (value: string) => fireEvent.change(slugInput(), { target: { value } });

beforeEach(() => {
  h.save.mockReset();
  h.save.mockImplementation(async () => {});
});

describe("the article's address in the admin form", () => {
  it("prefills an existing article's slug", () => {
    renderAdmin();
    edit(0);
    expect(slugInput().value).toBe("horadat-dmei-nihul");
  });

  it("asks for one on a new article, and will not save without it", () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /מאמר חדש/ }));
    expect(screen.getByText(SLUG_PROBLEMS.missing)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it.each([
    ["Dmei Nihul", SLUG_PROBLEMS.format],
    ["64f0a1b2c3d4e5f6a7b8c9d0", SLUG_PROBLEMS.base44Id],
    ["mutavim", SLUG_TAKEN],
  ])("refuses %j", (value, message) => {
    renderAdmin();
    edit(0);
    typeSlug(value);
    expect(screen.getByText(message)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it("warns before a published article's address changes", () => {
    renderAdmin();
    edit(0);
    typeSlug("dmei-nihul");
    expect(screen.getByRole("status").textContent).toMatch(/ישבור קישורים/);
    expect(screen.getByRole("status").textContent).toContain("/blog/horadat-dmei-nihul");
  });

  it("does not warn for a draft, which nobody links to yet", () => {
    renderAdmin();
    edit(1);
    typeSlug("mutavim-2026");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("sends the slug with the article", async () => {
    renderAdmin();
    edit(0);
    typeSlug("dmei-nihul-2026");
    fireEvent.click(saveButton());
    await vi.waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save).toHaveBeenCalledWith({
      id: "64f0a1b2c3d4e5f6a7b8c9d0",
      draft: expect.objectContaining({ slug: "dmei-nihul-2026" }),
    });
  });

  it("accepts a legacy fallback slug as it is", () => {
    renderAdmin();
    edit(2);
    expect(slugInput().value).toBe("post-6ac8eb62b0a953274445869d");
    expect(screen.queryByText(SLUG_PROBLEMS.missing)).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it("asks a legacy article with no slug for one, and saves once it has one", () => {
    renderAdmin();
    edit(3);
    expect(slugInput().value).toBe("");
    expect(screen.getByText(SLUG_PROBLEMS.missing)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    typeSlug("yashan-bli-ktovet");
    expect(saveButton().disabled).toBe(false);
  });

  it("shows the server's words when the address is taken (409), and the form stays editable", async () => {
    h.save.mockRejectedValueOnce(Object.assign(new Error(SLUG_TAKEN), { status: 409 }));
    renderAdmin();
    edit(0);
    typeSlug("dmei-nihul-2026");
    fireEvent.click(saveButton());
    expect((await screen.findByRole("alert")).textContent).toBe(SLUG_TAKEN);
    expect(slugInput().disabled).toBe(false);
    expect(saveButton().disabled).toBe(false);
  });

  it("shows the server's words when the address is invalid (400)", async () => {
    const text = "כתובת המאמר חסרה או אינה תקינה.";
    h.save.mockRejectedValueOnce(Object.assign(new Error(text), { status: 400 }));
    renderAdmin();
    edit(0);
    typeSlug("dmei-nihul-2026");
    fireEvent.click(saveButton());
    expect((await screen.findByRole("alert")).textContent).toBe(text);
  });

  it("keeps the generic message for any other failure, never the raw server text", async () => {
    h.save.mockRejectedValueOnce(Object.assign(new Error("internal: db password"), { status: 500 }));
    renderAdmin();
    edit(0);
    typeSlug("dmei-nihul-2026");
    fireEvent.click(saveButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("שמירת המאמר נכשלה. ניתן לנסות שוב.");
  });
});
