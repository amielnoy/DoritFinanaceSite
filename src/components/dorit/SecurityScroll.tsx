import React, { useEffect, useState } from "react";

export default function SecurityScroll() {
  const [progress, setProgress] = useState<number>(0);

  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setProgress(max > 0 ? (h.scrollTop / max) * 100 : 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="fixed left-0 top-0 bottom-0 z-40 w-px bg-border/40 hidden md:block">
      <div
        className="absolute top-0 left-0 w-px bg-[#C4A484] transition-[height] duration-150"
        style={{ height: `${progress}%` }}
      />
    </div>
  );
}