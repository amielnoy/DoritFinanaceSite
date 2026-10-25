import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const getHashId = (hash) => {
  const rawId = hash.slice(1);

  try {
    return decodeURIComponent(rawId);
  } catch {
    return rawId;
  }
};

export default function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  // React Router reports the first page load as a POP too. Back and forward
  // keep the browser's own scroll position, but a link opened fresh with a
  // hash — a campaign's /?…#start, the sticky bar's /#start from an email —
  // must still reach its section.
  const firstRender = useRef(true);

  useEffect(() => {
    const first = firstRender.current;
    firstRender.current = false;
    if (navigationType === "POP" && !(first && hash)) return;

    if (hash) {
      // Most pages are lazy, so the target may not exist yet. One fixed delay
      // fired before /faq's chunk arrived and left the visitor at the top, a
      // page of answers away from the support chat. Keep looking until it
      // mounts, and give up quietly after a few seconds.
      const id = getHashId(hash);
      const deadline = Date.now() + 3000;
      let timer;
      const tryScroll = () => {
        const target = document.getElementById(id);
        if (target) {
          target.scrollIntoView({ behavior: "smooth" });
          return;
        }
        if (Date.now() < deadline) timer = window.setTimeout(tryScroll, 50);
      };
      timer = window.setTimeout(tryScroll, 50);
      return () => window.clearTimeout(timer);
    }

    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, hash, navigationType]);

  return null;
}
