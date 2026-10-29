import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, entityNames, loadEntity } from "../helpers/entity-schema";
import { read, rel, sourceFiles } from "../helpers/source-scan";

const FILES = sourceFiles();
const INDEX_HTML = readFileSync(join(REPO_ROOT, "index.html"), "utf8");
/** Tracked files, or null when this is not a git work tree (e.g. the test image). */
const tracked = (): string[] | null => {
  try {
    return execFileSync("git", ["ls-files"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return null;
  }
};

describe("no secrets in the repo", () => {
  const SECRET_PATTERNS: Array<[string, RegExp]> = [
    ["Stripe live key", /sk_live_[A-Za-z0-9]{16,}/],
    ["AWS access key id", /AKIA[0-9A-Z]{16}/],
    ["Google API key", /AIza[0-9A-Za-z\-_]{35}/],
    ["private key block", /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["hardcoded JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
    ["assigned secret literal", /\b(api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password)\s*[:=]\s*["'][^"'\s]{12,}["']/i],
  ];

  for (const [label, pattern] of SECRET_PATTERNS) {
    it(`contains no ${label}`, () => {
      const hits = FILES.filter((f) => pattern.test(read(f))).map(rel);
      expect(hits).toEqual([]);
      expect(pattern.test(INDEX_HTML), "index.html").toBe(false);
    });
  }

  it("keeps env files out of version control", () => {
    const files = tracked();
    if (files === null) {
      // No .git here — the .gitignore assertion below still covers the rule.
      expect(existsSync(join(REPO_ROOT, ".env"))).toBe(false);
      return;
    }
    const committed = files.filter((f) => /(^|\/)\.env($|\.)/.test(f));
    expect(committed).toEqual([]);
  });

  it("gitignores the local env and the Base44 app pointer", () => {
    const ignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/base44\/\.app\.jsonc/);
  });
});

describe("no dangerous DOM/JS sinks in first-party code", () => {
  it("never uses eval or the Function constructor", () => {
    const hits = FILES.filter((f) => /\beval\s*\(|new\s+Function\s*\(/.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it("never injects raw HTML (dangerouslySetInnerHTML / innerHTML / document.write)", () => {
    const hits = FILES.filter((f) =>
      /dangerouslySetInnerHTML|\.innerHTML\s*=|document\.write\s*\(/.test(read(f))
    ).map(rel);
    expect(hits).toEqual([]);
  });

  it("renders blog markdown without enabling raw HTML passthrough", () => {
    const blogPost = read(join(REPO_ROOT, "src/pages/BlogPost.tsx"));
    expect(blogPost).toContain("ReactMarkdown");
    // rehype-raw / remark-html would re-open the XSS hole react-markdown closes.
    expect(blogPost).not.toMatch(/rehype-raw|rehypeRaw|skipHtml={false}|remark-html/);
  });
});

describe("outbound links are safe", () => {
  const openers = FILES.flatMap((f) => {
    const src = read(f);
    const anchors = src.match(/<a\b[\s\S]*?>/g) ?? [];
    return anchors
      .filter((a) => /target=["']_blank["']/.test(a))
      .map((a) => ({ file: rel(f), tag: a.replace(/\s+/g, " ") }));
  });

  it("finds the site's new-tab links", () => {
    expect(openers.length).toBeGreaterThan(0);
  });

  it("every target=_blank link sets rel=noopener (reverse tabnabbing)", () => {
    const bad = openers.filter((o) => !/rel=["'][^"']*noopener/.test(o.tag));
    expect(bad.map((b) => `${b.file}: ${b.tag}`)).toEqual([]);
  });

  it("every target=_blank link also sets noreferrer", () => {
    const bad = openers.filter((o) => !/rel=["'][^"']*noreferrer/.test(o.tag));
    expect(bad.map((b) => `${b.file}: ${b.tag}`)).toEqual([]);
  });

  it("no source file loads anything over plaintext http://", () => {
    const hits = FILES.filter((f) => /["'`]http:\/\/(?!localhost|127\.0\.0\.1)/.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it("index.html loads every external asset over https", () => {
    const urls = INDEX_HTML.match(/(?:href|src)="([^"]+)"/g) ?? [];
    const insecure = urls.filter((u) => u.includes('="http://'));
    expect(insecure).toEqual([]);
  });
});

describe("auth and token handling", () => {
  it("pages that consume ?returnTo= go through the shared open-redirect guard", () => {
    // Login reads an attacker-controllable returnTo out of the URL. Register
    // did too, until sign-up went with email-and-password.
    for (const page of ["src/pages/Login.tsx"]) {
      const src = read(join(REPO_ROOT, page));
      expect(src, `${page} must import safeReturnTo`).toMatch(
        /import\s*\{[^}]*safeReturnTo[^}]*\}\s*from\s*["']@\/lib\/authReturnTo["']/
      );
    }
  });

  it("no page reads returnTo out of the query string without the guard", () => {
    const offenders = FILES.filter((f) => {
      const src = read(f);
      if (rel(f) === "src/lib/authReturnTo.js") return false;
      return /(searchParams|URLSearchParams[^;]*)\.get\(\s*["']returnTo["']\s*\)/.test(src);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it("redirects derived from returnTo are assigned from the guarded value", () => {
    const login = read(join(REPO_ROOT, "src/pages/Login.tsx"));
    expect(login).toMatch(/const\s+returnTo\s*=\s*safeReturnTo\(\)/);
    // The destination used to be assigned to `window.location.href` by the
    // password form's success path. That form went with email-and-password
    // sign-in, and the hand-off then named the SDK directly; it now goes
    // through the auth port so that switching provider switches where the
    // visitor actually signs in. Same property throughout — what leaves this
    // page is the guarded value — asserted at the one place it still leaves.
    expect(login).toMatch(/services\.auth\.signInWithGoogle\(\s*returnTo\s*\)/);
  });

  it("admin routes stay behind a gate that requires sign-in and an agency role (agency roles)", () => {
    // Each agency screen sits inside AgencyRoute at the least role it needs; the
    // gate delegates to ProtectedRoute when signed out, asks the database for
    // the role, and turns away anyone below. This asserts the blocks that hold
    // the pages *and* that the gate itself still gates — a gate that stopped
    // doing either would pass a "is it wrapped" check alone.
    const app = read(join(REPO_ROOT, "src/App.jsx"));
    const block = (open: string) => {
      const at = app.indexOf(open);
      expect(at, `${open} must exist`).toBeGreaterThan(-1);
      return app.slice(at, app.indexOf("</Route>\n        </Route>", at));
    };
    const users = block('<AgencyRoute min="user"');
    for (const path of ["/admin/leads", "/admin/blog", "/admin/users"]) {
      expect(users, `${path} must be inside AgencyRoute min="user"`).toContain(path);
    }
    expect(block('<AgencyRoute min="owner"'), "the agency profile is the Owner's").toContain('path="/admin/agency"');
    // Registered once each: no admin page outside its gate.
    for (const path of ["/admin/leads", "/admin/blog", "/admin/users", "/admin/agency"]) {
      expect(app.split(`path="${path}"`).length - 1, path).toBe(1);
    }

    const gate = read(join(REPO_ROOT, "src/components/AgencyRoute.tsx"));
    expect(gate, "AgencyRoute must fall back to the auth gate when signed out").toContain("<ProtectedRoute");
    expect(gate, "AgencyRoute must turn away a role below the screen's").toMatch(/if \(!meets\(role, min\)\) return <Navigate to="\/" replace \/>;/);
    const hook = read(join(REPO_ROOT, "src/hooks/useAgency.ts"));
    expect(hook, "the role is asked of the database, not the token").toContain("services.agency.myRole(agencyId)");
    // AdminRoute stays for the platform operator's own screens.
    const admin = read(join(REPO_ROOT, "src/components/AdminRoute.jsx"));
    expect(admin).toContain("<ProtectedRoute");
    expect(admin).toMatch(/role\s*!==\s*['"]admin['"]/);
  });

  it("keeps the clearinghouse board behind a gate that requires sign-in and an agency role, and only when switched on", () => {
    const app = read(join(REPO_ROOT, "src/App.jsx"));
    const gateStart = app.indexOf("{MASLEKA_ENABLED ? (");
    expect(gateStart, "the clearinghouse pages must be switched").toBeGreaterThan(-1);
    const gateBlock = app.slice(gateStart, app.indexOf(") : null}", gateStart));
    expect(gateBlock).toMatch(/<AgencyRoute min="user"/);
    expect(gateBlock).toContain('path="/admin/masleka"');
    expect(gateBlock).toContain('path="/admin/masleka/guide"');
    // Registered nowhere else: no /admin/masleka route outside the switched block.
    expect(app.split('path="/admin/masleka').length - 1).toBe(gateBlock.split('path="/admin/masleka').length - 1);
  });

  it("the clearinghouse board keeps a revealed value out of storage, logs and the access log", () => {
    // The access log is written by masleka-reveal, server-side, before it
    // decrypts (Ruling 17); the page never writes it, never persists what it
    // was shown, and never logs.
    const board = read(join(REPO_ROOT, "src/pages/MaslekaBoard.tsx"));
    expect(board).not.toMatch(/masleka_access_log/);
    expect(board).not.toMatch(/\b(localStorage|sessionStorage|indexedDB)\b/);
    expect(board).not.toMatch(/\bconsole\./);
    expect(board).not.toMatch(/\b(gtag|dataLayer|trackEvent|track)\s*\(/);
    expect(board).not.toMatch(/history\.(push|replace)State|navigate\(/);
  });
});

describe("data exposure via entity RLS", () => {
  it("no entity that stores personal data is world-readable", () => {
    const pii = ["Lead"];
    for (const name of pii) {
      expect(loadEntity(name).rls?.read, `${name} leads are readable by anyone`).not.toBe(true);
    }
  });

  it("every entity used by the app has an explicit definition", () => {
    const referenced = new Set<string>();
    for (const f of FILES) {
      for (const m of read(f).matchAll(/base44\.entities\.(\w+)\./g)) referenced.add(m[1]);
    }
    for (const name of referenced) expect(entityNames()).toContain(name);
  });
});
