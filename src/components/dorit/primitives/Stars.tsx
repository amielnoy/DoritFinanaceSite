import React from "react";
import { Star } from "lucide-react";

interface StarsProps {
  value?: number;
  size?: number;
}

export default function Stars({ value = 0, size = 16 }: StarsProps) {
  const rounded = Math.round(Number(value) || 0);
  // role="img": aria-label is prohibited on a bare div (axe: aria-prohibited-attr).
  return (
    <div role="img" className="flex items-center gap-0.5" aria-label={`דירוג ${rounded} מתוך 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={n <= rounded ? "text-highlight fill-highlight" : "text-border"}
          strokeWidth={1.5}
        />
      ))}
    </div>
  );
}