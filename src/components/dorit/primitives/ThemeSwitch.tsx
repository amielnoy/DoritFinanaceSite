import React from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/LocaleContext";

export default function ThemeSwitch({ dark, onChange, className }: { dark: boolean; onChange(dark: boolean): void; className?: string }) {
  const t = useT("common");
  const option = (value: boolean, label: string, Icon: typeof Sun) => (
    <button
      type="button"
      aria-pressed={dark === value}
      aria-label={label}
      title={label}
      onClick={() => onChange(value)}
      className={cn(
        "w-9 h-8 flex items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
        dark === value ? "bg-card text-accent shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
  return (
    <div className={cn("flex items-center gap-0.5 p-1 rounded-full bg-secondary border border-border", className)}>
      {option(false, t("header.themeLight"), Sun)}
      {option(true, t("header.themeDark"), Moon)}
    </div>
  );
}
