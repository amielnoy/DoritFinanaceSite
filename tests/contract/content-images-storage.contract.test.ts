import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Article and testimonial images on Supabase: a public bucket only an admin
 * can write. Public, because every visitor's <img> loads these by plain URL;
 * admin-only, because a public bucket anyone could fill is free hosting under
 * Dorit's domain name for whatever they like.
 */
const REPO_ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");
const sql = read("supabase/migrations/20261017000000_content_images_storage.sql");
// Statements only, so a comment explaining what is absent never reads as present.
const code = sql.replace(/--[^\n]*/g, "");

describe("the content-images bucket", () => {
  it("is public, images only, with a size limit", () => {
    expect(code).toMatch(/insert into storage\.buckets[\s\S]*?'content-images',\s*'content-images',\s*true,/);
    expect(code).toMatch(/file_size_limit[\s\S]*?5242880/);
    const types = code.match(/array\[([^\]]*)\]/)?.[1] ?? "";
    expect(types.split(",").map((t) => t.trim().replace(/'/g, "")).sort()).toEqual(
      ["image/gif", "image/jpeg", "image/png", "image/webp"],
    );
  });

  it("lets only a signed-in admin upload", () => {
    const policies = code.match(/create policy[\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(1);
    const [insert] = policies;
    expect(insert).toMatch(/on storage\.objects\s+for insert\s+to authenticated/);
    expect(insert).toMatch(/with check \(\s*bucket_id = 'content-images'\s+and public\.is_admin\(\)\s*\)/);
    // Never anon, and no update/delete/select policy: a public bucket is read
    // by URL without one, and nothing in the site replaces or removes images.
    expect(insert).not.toMatch(/\banon\b/);
  });
});

describe("the site may show those images", () => {
  it("allows img-src from the bucket's public path only, not the whole Supabase host", () => {
    const csp = JSON.stringify(JSON.parse(read("vercel.json")).headers);
    const imgSrc = csp.match(/img-src([^;"]*)/)?.[1] ?? "";
    expect(imgSrc).toContain(
      "https://hjowdyiwjjrqceumkvgt.supabase.co/storage/v1/object/public/content-images/",
    );
    expect(imgSrc.split(/\s+/)).not.toContain("https://hjowdyiwjjrqceumkvgt.supabase.co");
  });

  it("allows img-src from agent-photos' public path only", () => {
    const csp = JSON.stringify(JSON.parse(read("vercel.json")).headers);
    const imgSrc = csp.match(/img-src([^;"]*)/)?.[1] ?? "";
    expect(imgSrc).toContain(
      "https://hjowdyiwjjrqceumkvgt.supabase.co/storage/v1/object/public/agent-photos/",
    );
    expect(imgSrc.split(/\s+/)).not.toContain("https://hjowdyiwjjrqceumkvgt.supabase.co");
  });
});
