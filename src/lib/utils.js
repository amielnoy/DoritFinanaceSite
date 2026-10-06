import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 


// Guarded so the module loads outside a browser (SSR, prerender, node tests).
export const isIframe = typeof window !== "undefined" && window.self !== window.top;
