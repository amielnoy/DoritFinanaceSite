import React, { useMemo } from "react";
import Term from "@/components/dorit/primitives/Term";
import { glossSegments, type GlossScope } from "@/lib/glossary";
import { useLocale } from "@/i18n/LocaleContext";

/**
 * Running text with its glossary terms marked (`Term`). Use it on paragraphs
 * and list items only — never inside a link, a button, a label or an
 * accordion trigger, where a second interactive element is invalid.
 */
export default function Glossed({ text, scope }: { text: string; scope?: GlossScope }) {
  const locale = useLocale();
  const parts = useMemo(() => glossSegments(text, locale, scope), [text, locale, scope]);
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <React.Fragment key={i}>{p}</React.Fragment>
        ) : (
          <Term key={i} id={p.id}>
            {p.text}
          </Term>
        ),
      )}
    </>
  );
}

/**
 * The same for children that may mix strings and elements (a Markdown
 * paragraph): strings are glossed, elements — links, emphasis — pass through
 * untouched.
 */
export function GlossedChildren({ children, scope }: { children: React.ReactNode; scope?: GlossScope }) {
  return (
    <>
      {React.Children.map(children, (child) =>
        typeof child === "string" ? <Glossed text={child} scope={scope} /> : child,
      )}
    </>
  );
}
