/**
 * The contact boxes inside an article (src/components/dorit/blog/ArticleContactBox.tsx):
 * where the first one goes, what it says, and which next step it offers.
 */
import type { Article } from "@/services";
import { PENSION_CHECK, YEAR_END } from "@/config/offers";

export const ARTICLE_CTA_FALLBACK = "יש לך שאלה על הנושא הזה? דורית עונה אישית בוואטסאפ";

/** The box's headline: the article's own (`blog_posts.cta_headline`), else the general line. */
export function articleCtaHeadline(post: Pick<Article, "cta_headline">): string {
  return post.cta_headline?.trim() || ARTICLE_CTA_FALLBACK;
}

/** WhatsApp's pre-filled message, naming the article. */
export function articleWhatsappText(title: string): string {
  return `שלום דורית, קראתי את המאמר "${title}" ואשמח לשאלה קצרה`;
}

export interface ArticleOffer {
  href: string;
  label: string;
  kind: "year_end" | "pension_check" | "tools";
}

/**
 * The one next step that fits the article's topic, beside WhatsApp (growth
 * brief, 2026-10-14), by its tags, most specific first: the self-employed get
 * the year-end page; pension, savings and fees get the clearinghouse check
 * ("המעסיק באמת מפקיד?" → "נבדוק לך במסלקה"); insurance gets /tools' self-check.
 * Anything else — tax refunds, Form 101 — gets WhatsApp alone.
 */
export function articleOffer(post: Pick<Article, "tags">): ArticleOffer | null {
  const tags = (post.tags ?? "").split(",").map((t) => t.trim());
  if (tags.includes("עצמאים")) return { href: YEAR_END.path, label: "מה להפקיד עד 31.12", kind: "year_end" };
  if (tags.some((t) => ["פנסיה", "גמל והשתלמות", "דמי ניהול"].includes(t)))
    return { href: PENSION_CHECK.path, label: "נבדוק לך במסלקה", kind: "pension_check" };
  if (tags.includes("ביטוח")) return { href: "/tools", label: "לבדיקה במחשבון", kind: "tools" };
  return null;
}

/** A block that is not a paragraph: a heading, list, quote, table, rule or HTML. */
const NOT_PARAGRAPH = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||---|\*\*\*|<)/;

/**
 * Splits Markdown after its `n`th paragraph, or returns null when there is
 * nothing after it (the box at the end of the article is enough then). Blocks
 * are separated by blank lines; a fenced block is never split.
 */
export function splitAfterParagraph(body: string, n: number): [string, string] | null {
  const blocks: string[] = [];
  let fence: string[] | null = null;
  for (const part of body.split(/\n{2,}/)) {
    if (fence) {
      fence.push(part);
      if (/^```/m.test(part.split("\n").slice(-1)[0] ?? "")) {
        blocks.push(fence.join("\n\n"));
        fence = null;
      }
      continue;
    }
    const opens = (part.match(/^```/gm) ?? []).length;
    if (opens % 2 === 1) fence = [part];
    else blocks.push(part);
  }
  if (fence) blocks.push(fence.join("\n\n"));

  let seen = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i].trim();
    if (b && !b.startsWith("```") && !NOT_PARAGRAPH.test(b)) seen++;
    if (seen === n) {
      const rest = blocks.slice(i + 1).join("\n\n").trim();
      return rest ? [blocks.slice(0, i + 1).join("\n\n").trim(), rest] : null;
    }
  }
  return null;
}
