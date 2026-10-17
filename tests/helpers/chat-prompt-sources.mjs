// The chat function's prompts are the Markdown files in
// supabase/functions/chat/prompts/ — their only source since the agents left
// Base44 (2026-10-17). One of them is derived: compliance.md is
// docs/COMPLIANCE.md §3 and §5, verbatim.
// tests/contract/chat-prompts.contract.test.ts holds the files to that rule.

/** A `## N.` section of COMPLIANCE.md, from its heading to the next `## ` heading. */
export function complianceSection(md, number) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## ${number}.`));
  if (start === -1) throw new Error(`COMPLIANCE.md has no section ${number}`);
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start, end === -1 ? undefined : end).join('\n').trim();
}

/** The model-facing rules: what is forbidden (§3) and how a hand-off goes (§5). */
export function complianceExcerpt(md) {
  return `${complianceSection(md, 3)}\n\n${complianceSection(md, 5)}`;
}
