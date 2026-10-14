// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SnapshotHome from "@/components/dorit/sections/SnapshotHome";
import { CONTACT } from "@/config/contact";

const region = (name: string) => within(screen.getByRole("region", { name }));

describe("<SnapshotHome /> — the personal snapshot on the home page", () => {
  it("leads with the headline as an h2 — the page keeps its one h1", () => {
    render(<SnapshotHome />);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "כל הפנסיה, החיסכון והביטוח שלכם — בתמונה אחת. ומתכננת שבודקת אותה." }),
    ).toBeInTheDocument();
    expect(screen.getByText("חדש באתר · תמונת מצב אישית")).toBeInTheDocument();
  });

  it("starts at the questionnaire, and explains first if asked", () => {
    render(<SnapshotHome />);
    expect(screen.getByRole("link", { name: "להתחיל — מסירת קוד המסלקה" })).toHaveAttribute("href", "#start");
    expect(screen.getByRole("link", { name: "איך זה עובד" })).toHaveAttribute("href", "#how-it-works");
    expect(document.getElementById("how-it-works")).not.toBeNull();
  });

  it("labels the preview's numbers as sample data", () => {
    render(<SnapshotHome />);
    const preview = screen.getByRole("figure", { name: "תצוגה מקדימה — נתוני דוגמה" });
    expect(within(preview).getByText("נתוני דוגמה")).toBeInTheDocument();
  });

  it("walks through three steps, with no timing until Dorit confirms one", () => {
    render(<SnapshotHome />);
    const steps = region("שלושה צעדים, ודורית עושה את רובם").getAllByRole("listitem");
    expect(steps.map((s) => within(s).getByRole("heading").textContent)).toEqual([
      "מוסרים קוד מהמסלקה",
      "דורית עוברת על הנתונים",
      "תמונת מצב והמלצות",
    ]);
    expect(screen.queryByText(/ימי עסקים|יום עסקים/)).not.toBeInTheDocument();
  });

  it("names the four things the personal area shows", () => {
    render(<SnapshotHome />);
    expect(region("מה תראו באזור האישי").getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "כל הקופות במקום אחד",
      "דמי ניהול מול השוק",
      "תחזית לפרישה",
      "כיסויים, חוסרים וכפלים",
    ]);
  });

  it("reaches Dorit directly from the dark band, by the numbers in the contact config", () => {
    render(<SnapshotHome />);
    const band = region("אפליקציה מראה מספרים. מתכננת אומרת מה לעשות איתם.");
    expect(band.getByRole("link", { name: "חיוג" })).toHaveAttribute("href", `tel:${CONTACT.phoneE164}`);
    const whatsapp = band.getByRole("link", { name: "וואטסאפ" });
    expect(whatsapp.getAttribute("href")).toMatch(new RegExp(`^https://wa\\.me/${CONTACT.whatsapp}\\?text=`));
    expect(whatsapp).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("lists four tools, the two new ones tagged חדש", () => {
    render(<SnapshotHome />);
    const tools = region("לבדוק לבד, לפני שמדברים").getAllByRole("link");
    expect(tools.map((a) => a.getAttribute("href"))).toEqual([
      "/tools#fee-calculator",
      "/tools#assessment",
      "/tools#retirement",
      "/tools#har-habituach",
    ]);
    expect(tools.map((a) => within(a).queryByText("חדש") !== null)).toEqual([false, false, true, true]);
  });

  it("makes no claim of a free check and counts no users or savings", () => {
    const { container } = render(<SnapshotHome />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/חינם|ללא עלות|בחינם/);
    expect(text).not.toMatch(/לקוחות מרוצים|חסכנו|נחסכו/);
  });
});
