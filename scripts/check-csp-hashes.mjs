#!/usr/bin/env node
// Every inline script in the built site must be allowed by the enforced CSP.
//
// vercel.json's `script-src` allows inline scripts by hash, not with
// 'unsafe-inline'. A hash is of the script's exact text, so any change to it —
// an edit to the gtag snippet in index.html, or the Base44 Vite plugin's
// page-view logger changing with a plugin upgrade or a different app id baked
// in — leaves a script the browser silently refuses. Nothing on the page says
// so; analytics just stop. Run after `vercel build`, this fails the deploy
// instead, naming the hash to add.
//
// Usage: node scripts/check-csp-hashes.mjs <dir-of-built-html> [vercel.json]

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Types a browser executes; anything else (ld+json, importmap…) is data. */
const EXECUTABLE = new Set(["", "module", "text/javascript", "application/javascript"]);

/** The enforced policy from vercel.json — not the report-only one. */
export function enforcedPolicy(vercelJson) {
  for (const rule of vercelJson.headers ?? []) {
    for (const h of rule.headers ?? []) {
      if (h.key.toLowerCase() === "content-security-policy") return h.value;
    }
  }
  return null;
}

/** Hashes of the inline scripts in `html` that `policy` does not allow. */
export function missingInlineHashes(html, policy) {
  const allowed = new Set([...policy.matchAll(/'(sha256-[^']+)'/g)].map((m) => m[1]));
  const missing = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? "").toLowerCase();
    if (!EXECUTABLE.has(type)) continue;
    const hash = `sha256-${createHash("sha256").update(m[2], "utf8").digest("base64")}`;
    if (!allowed.has(hash)) missing.push({ hash, start: m[2].trim().slice(0, 60) });
  }
  return missing;
}

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return htmlFiles(p);
    return p.endsWith(".html") ? [p] : [];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, config = "vercel.json"] = process.argv.slice(2);
  if (!dir) {
    console.error("usage: check-csp-hashes.mjs <dir-of-built-html> [vercel.json]");
    process.exit(2);
  }
  const policy = enforcedPolicy(JSON.parse(readFileSync(config, "utf8")));
  if (!policy) {
    console.error(`::error::${config} has no enforced Content-Security-Policy header.`);
    process.exit(1);
  }
  const seen = new Map();
  const files = htmlFiles(dir);
  for (const file of files) {
    for (const m of missingInlineHashes(readFileSync(file, "utf8"), policy)) {
      if (!seen.has(m.hash)) seen.set(m.hash, { ...m, files: [] });
      seen.get(m.hash).files.push(file);
    }
  }
  if (seen.size) {
    for (const m of seen.values()) {
      console.error(
        `::error::An inline script is not allowed by the CSP — the browser will refuse it. ` +
          `Add '${m.hash}' to script-src in vercel.json (in ${m.files.length} page(s), starts ${JSON.stringify(m.start)}).`,
      );
    }
    process.exit(1);
  }
  console.log(`CSP: every inline script in ${files.length} page(s) is allowed by hash.`);
}
