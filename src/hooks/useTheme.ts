import { useState } from "react";

const THEME_KEY = "theme";

export function useTheme() {
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  const choose = (next: boolean) => {
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      return;
    }
  };
  return [dark, choose] as const;
}
