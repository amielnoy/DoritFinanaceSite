import React from "react";
import { Star } from "lucide-react";

export default function Stars({ value = 0, size = 16 }) {
  const rounded = Math.round(Number(value) || 0);
  return (
    <div className="flex items-center gap-0.5" aria-label={`דירוג ${rounded} מתוך 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={n <= rounded ? "text-[#C4A484] fill-[#C4A484]" : "text-border"}
          strokeWidth={1.5}
        />
      ))}
    </div>
  );
}