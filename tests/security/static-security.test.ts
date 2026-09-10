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

  it("reads app configuration from import.meta.env, never from literals", () => {
    const appParams = read(join(REPO_ROOT, "src/lib/app-params.js"));
    expect(appParams).toContain("import.meta.env.VITE_BASE44_APP_ID");
    expect(appParams).not.toMatch(/appId:\s*["'][\w-]{8,}["']/);
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
  it("only app-params.js and the SDK touch the stored access token", () => {
    const touchers = FILES.filter((f) => /base44_access_token|localStorage\.(get|set|remove)Item\(\s*["']token["']/.test(read(f))).map(rel);
    expect(touchers).toEqual(["src/lib/app-params.js"]);
  });

  it("pages that consume ?returnTo= go through the shared open-redirect guard", () => {
    // Login and Register read an attacker-controllable returnTo out of the URL.
    for (const page of ["src/pages/Login.tsx", "src/pages/Register.tsx"]) {
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
    expect(login).toMatch(/window\.location\.href\s*=\s*returnTo/);
  });

  it("admin routes stay behind a gate that requires both sign-in and the admin role", () => {
    // The admin pages used to sit directly inside ProtectedRoute, an auth-only
    // gate. They now sit inside AdminRoute, which delegates to ProtectedRoute
    // when signed out and additionally turns away non-admins — so this asserts
    // the block that holds them *and* that the gate itself still gates. A gate
    // that stopped doing either would pass a "is it wrapped" check alone.
    const app = read(join(REPO_ROOT, "src/App.jsx"));
    const gateStart = app.indexOf("<AdminRoute");
    expect(gateStart, "the admin pages must be wrapped in AdminRoute").toBeGreaterThan(-1);

    const gateBlock = app.slice(gateStart, app.indexOf("</Route>", gateStart));
    for (const path of ["/admin/leads", "/admin/blog"]) {
      expect(gateBlock, `${path} must be inside AdminRoute`).toContain(path);
    }

    const gate = read(join(REPO_ROOT, "src/components/AdminRoute.jsx"));
    expect(gate, "AdminRoute must fall back to the auth gate when signed out").toContain(
      "<ProtectedRoute"
    );
    expect(gate, "AdminRoute must turn away non-admin roles").toMatch(/role\s*!==\s*['"]admin['"]/);
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
