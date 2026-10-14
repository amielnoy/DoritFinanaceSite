/**
 * The contact boxes inside an article (src/components/dorit/blog/ArticleContactBox.tsx):
 * where the first one goes, what it says, and when it also offers /tools.
 */
import type { Article } from "@/services";

export const ARTICLE_CTA_FALLBACK = "יש לך שאלה על הנושא הזה? דורית עונה אישית בוואטסאפ";

/** The box's headline: the article's own (`blog_posts.cta_headline`), else the general line. */
export function articleCtaHeadline(post: Pick<Article, "cta_headline">): string {
  return post.cta_headline?.trim() || ARTICLE_CTA_FALLBACK;
}

/** WhatsApp's pre-filled message, naming the article. */
export function articleWhatsappText(title: string): string {
  return `שלום דורית, קראתי את המאמר "${title}" ואשמח לשאלה קצרה`;
}

/**
 * /tools has two tools — the pension fee calculator and the insurance check —
 * so the link is offered only on an article tagged with what one of them covers.
 */
const TOOL_TAGS = ["דמי ניהול", "ביטוח"];
export function showsToolsLink(post: Pick<Article, "tags">): boolean {
  const tags = (post.tags ?? "").split(",").map((t) => t.trim());
  return tags.some((t) => TOOL_TAGS.includes(t));
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
