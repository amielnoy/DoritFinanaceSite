import type { BeforeSendEvent } from '@vercel/analytics';

/**
 * Vercel Web Analytics records the full URL of each page view. The clearinghouse
 * link keeps its one-time token in the fragment (`/masleka#t=<token>`), so the
 * fragment is cut from every event before it leaves the browser. Admin URLs
 * can contain names and addresses in their search query: never report them.
 * Drop free-text search on public URLs too, including copied admin queries.
 */
export function stripFragment(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url);
    if (/^\/admin(?:\/|$)/.test(url.pathname)) return null;
    url.hash = '';
    url.searchParams.delete('q');
    return { ...event, url: url.toString() };
  } catch {
    return null;
  }
}
