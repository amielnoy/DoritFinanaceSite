import React from "react";

/** "הובאו החודש": how many leads each member entered this month (Israel time). Admin+ only. */
export default function StaffLeadsStrip({ counts, label }: { counts: Map<string, number>; label: (id: string) => string }) {
  const rows = [...counts.entries()].map(([id, n]) => ({ id, n, name: label(id) })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return (
    <section aria-label="הובאו החודש" className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border border-border/60 bg-card px-4 py-3 text-sm">
      <h2 className="font-medium">הובאו החודש</h2>
      {rows.length === 0 ? (
        <span className="text-muted-foreground">עדיין לא נוספו פניות ידנית</span>
      ) : (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {rows.map((r) => (
            <li key={r.id}>
              <span dir="auto">{r.name}</span> <span className="tabular-nums font-medium">{r.n}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
