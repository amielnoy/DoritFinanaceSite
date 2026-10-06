import React from "react";
import { Link } from "react-router-dom";
import { AGENTS } from "@/config/agents";

const SECTION = AGENTS.support.sectionId;

/**
 * A link straight to the support chat, from any page.
 *
 * The chat sits at the bottom of /faq. From another route the router carries
 * the hash and `ScrollToTop` scrolls to it once the lazy page has mounted.
 * From /faq itself the URL does not change on a second press, so the router
 * sees nothing to do — this scrolls directly whenever the section is already
 * on the page.
 */
export default function SupportLink({
  className,
  children,
  ...rest
}: Omit<React.ComponentProps<typeof Link>, "to">) {
  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Leave modified clicks to the browser, or new-tab stops working.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const section = document.getElementById(SECTION);
    if (!section) return;
    e.preventDefault();
    section.scrollIntoView({ behavior: "smooth" });
    window.history.replaceState(window.history.state, "", `/faq#${SECTION}`);
  };

  return (
    <Link to={`/faq#${SECTION}`} onClick={onClick} className={className} {...rest}>
      {children}
    </Link>
  );
}
