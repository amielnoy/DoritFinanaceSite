import type { BeforeSendEvent } from '@vercel/analytics';

/**
 * Vercel Web Analytics records the full URL of each page view. The clearinghouse
 * link keeps its one-time token in the fragment (`/masleka#t=<token>`), so the
 * fragment is cut from every event before it leaves the browser.
 */
export function stripFragment(event: BeforeSendEvent): BeforeSendEvent {
  return { ...event, url: event.url.split('#')[0] };
}
