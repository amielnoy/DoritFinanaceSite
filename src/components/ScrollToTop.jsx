import { useEffect } from "react";
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

  useEffect(() => {
    if (navigationType === "POP") return;

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
