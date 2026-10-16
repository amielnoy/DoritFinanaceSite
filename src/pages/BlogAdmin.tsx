import React, { useState } from "react";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { services, type Article } from "@/services";
import {
  useAdminArticles,
  useRemoveArticle,
  useSaveArticle,
  useSetArticlePublished,
} from "@/hooks/useAdmin";
import { Image } from "@/components/ui/image";
import { SLUG_TAKEN, articlePath, slugProblem } from "@/lib/articlePath";
import { AGENCY_1, useAgencyRole } from "@/hooks/useAgency";
import {
  Plus,
  X,
  Trash2,
  Loader2,
  Upload,
  Save,
  Eye,
  EyeOff,
  Pencil,
} from "lucide-react";

/* The admin list shows drafts as well as published posts, so it reads through
   `contentAdmin` rather than the published-only `content` port. */
type BlogPostItem = Article;

interface BlogPostEdit {
  id?: string;
  title: string;
  /** The article's address, `/blog/<slug>`. Stored in the Supabase mirror only. */
  slug: string;
  /** The slug the article had when the editor opened — the address links already use. */
  originalSlug: string;
  /** Whether the article was live when the editor opened, so links to it may exist. */
  wasPublished: boolean;
  excerpt: string;
  body: string;
  image_url: string;
  tags: string;
  published: boolean;
}

const EMPTY: BlogPostEdit = {
  title: "",
  slug: "",
  originalSlug: "",
  wasPublished: false,
  excerpt: "",
  body: "",
  image_url: "",
  tags: "",
  published: false,
};

/** A stored article, with the optional fields the editor needs as strings. */
const toEdit = (p: BlogPostItem): BlogPostEdit => ({
  id: p.id,
  title: p.title,
  slug: p.slug ?? "",
  originalSlug: p.slug ?? "",
  wasPublished: !!p.published,
  excerpt: p.excerpt ?? "",
  body: p.body ?? "",
  image_url: p.image_url ?? "",
  tags: p.tags ?? "",
  published: !!p.published,
});

/** contentAdmin's answers to a slug it will not store (400 invalid, 409 taken). */
const SLUG_REFUSALS: Record<number, string> = {
  400: "כתובת המאמר חסרה או אינה תקינה.",
  409: SLUG_TAKEN,
};

/** The server's words for a slug refusal, or null for any other failure — unknown text is never shown. */
const refusalText = (err: unknown): string | null => {
  const { status, message } = err as { status?: unknown; message?: unknown };
  if (typeof status !== "number") return null;
  return SLUG_REFUSALS[status] !== undefined && message === SLUG_REFUSALS[status] ? SLUG_REFUSALS[status] : null;
};

export default function BlogAdmin() {
  const { data, isPending: loading, isError } = useAdminArticles();
  // The site's articles are agency 1's (content-admin writes them there). A
  // User writes drafts; publishing, editing a live article and deleting are
  // Admin+ — content-admin and the policies refuse them otherwise.
  const { can } = useAgencyRole(AGENCY_1);
  const publishes = can("blog.publish");
  const deletes = can("blog.delete");
  const saveArticle = useSaveArticle();
  const setPublished = useSetArticlePublished();
  const removeArticle = useRemoveArticle();

  const [editing, setEditing] = useState<BlogPostEdit | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  // The cover upload runs before the save mutation and is not part of it, so
  // it keeps its own in-flight flag; `busy` is what the button reads.
  const [uploading, setUploading] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  // Shown after a published article is unpublished or deleted: its prebuilt
  // public page stays up until the next production deploy.
  const [takedownNote, setTakedownNote] = useState<boolean>(false);

  const posts: BlogPostItem[] = data ?? [];
  const busy = uploading || saveArticle.isPending;
  const writeError = saveError || (removeArticle.isError || setPublished.isError ? "הפעולה האחרונה לא נשמרה. ניתן לנסות שוב." : "");
  // The form's own list holds every article's slug (drafts included), so a
  // taken one is caught here; contentAdmin refuses it again with 409.
  const slugError = editing
    ? slugProblem(editing.slug) ??
      (posts.some((p) => p.slug === editing.slug && p.id !== editing.id) ? SLUG_TAKEN : null)
    : null;
  // There is no redirect table: a published article's old address will 404.
  const slugChanged = Boolean(
    editing?.id && editing.wasPublished && editing.originalSlug && editing.slug !== editing.originalSlug,
  );

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const startNew = () => {
    setEditing({ ...EMPTY });
    setFile(null);
    setPreview("");
  };

  const startEdit = (p: BlogPostItem) => {
    setEditing(toEdit(p));
    setFile(null);
    setPreview(p.image_url || "");
  };

  const cancel = () => {
    setEditing(null);
    setFile(null);
    setPreview("");
    setSaveError("");
  };

  const save = async () => {
    if (!editing || !editing.title || !editing.body || slugError) return;
    setSaveError("");
    let image_url = editing.image_url;
    if (file) {
      setUploading(true);
      try {
        ({ url: image_url } = await services.uploads.upload(file));
      } catch {
        setSaveError("העלאת התמונה נכשלה. המאמר לא נשמר.");
        return;
      } finally {
        setUploading(false);
      }
    }
    // Kept as a literal object: tests/contract/frontend-payloads pins its keys
    // to the BlogPost entity schema. `slug` is the one exception, sent for the
    // Supabase mirror only (contentAdmin keeps it out of the Base44 write).
    const payload = {
      title: editing.title,
      slug: editing.slug,
      excerpt: editing.excerpt,
      body: editing.body,
      tags: editing.tags,
      published: !!editing.published,
      image_url,
    };
    try {
      await saveArticle.mutateAsync({ id: editing.id, draft: payload });
      setTakedownNote(editing.wasPublished && !editing.published);
      cancel();
    } catch (err) {
      setSaveError(refusalText(err) ?? "שמירת המאמר נכשלה. ניתן לנסות שוב.");
    }
  };

  const remove = (p: BlogPostItem) => {
    if (!window.confirm("למחוק את המאמר?")) return;
    setTakedownNote(false);
    removeArticle.mutate(p.id, { onSuccess: () => setTakedownNote(!!p.published) });
  };

  const togglePublished = (p: BlogPostItem) => {
    setTakedownNote(false);
    setPublished.mutate(
      { id: p.id, published: !p.published },
      { onSuccess: () => setTakedownNote(!!p.published) },
    );
  };

  return (
    <div className="min-h-screen bg-background pt-8 pb-20">
      <div className="max-w-[1200px] mx-auto px-6 md:px-10">
        <div className="flex items-center justify-between mb-10">
          <div>
            <Eyebrow>תוכן והגדרות</Eyebrow>
            <h1 className="font-heading text-4xl md:text-5xl mt-3">ניהול בלוג</h1>
          </div>
          <button
            onClick={startNew}
            className={ctaClass()}
          >
            <Plus size={18} /> מאמר חדש
          </button>
        </div>

        {editing && (
          <div className="mb-12 bg-card border border-border/60 p-6 md:p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-heading text-2xl">
                {editing.id ? "עריכת מאמר" : "מאמר חדש"}
              </h2>
              <button
                onClick={cancel}
                className="text-muted-foreground hover:text-foreground"
                aria-label="סגירה"
              >
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="md:col-span-2">
                <label className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
                  כותרת *
                </label>
                <input
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  className="w-full bg-background border border-border px-4 py-3 focus:outline-none focus:border-accent transition-colors"
                />
              </div>
              <div className="md:col-span-2">
                <label
                  htmlFor="blog-slug"
                  className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2"
                >
                  כתובת המאמר (slug) *
                </label>
                <input
                  id="blog-slug"
                  dir="ltr"
                  value={editing.slug}
                  onChange={(e) => setEditing({ ...editing, slug: e.target.value.toLowerCase() })}
                  placeholder="horadat-dmei-nihul"
                  aria-describedby="blog-slug-path"
                  aria-invalid={slugError ? true : undefined}
                  className="w-full bg-background border border-border px-4 py-3 font-mono text-sm focus:outline-none focus:border-accent transition-colors"
                />
                <p id="blog-slug-path" dir="ltr" className="mt-2 text-xs text-muted-foreground">
                  {articlePath({ id: editing.id ?? "", slug: editing.slug })}
                </p>
                {slugError ? (
                  <p aria-live="polite" className="mt-1 text-sm text-destructive">
                    {slugError}
                  </p>
                ) : null}
                {slugChanged ? (
                  <p role="status" className="mt-1 text-sm text-accent">
                    שינוי הכתובת של מאמר שפורסם ישבור קישורים קיימים אליו:{" "}
                    <span dir="ltr">{articlePath({ id: "", slug: editing.originalSlug })}</span> תחזיר "המאמר לא נמצא".
                  </p>
                ) : null}
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
                  תקציר
                </label>
                <textarea
                  value={editing.excerpt}
                  onChange={(e) =>
                    setEditing({ ...editing, excerpt: e.target.value })
                  }
                  rows={2}
                  className="w-full bg-background border border-border px-4 py-3 focus:outline-none focus:border-accent transition-colors resize-none"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
                  תוכן (Markdown) *
                </label>
                <textarea
                  value={editing.body}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  rows={10}
                  className="w-full bg-background border border-border px-4 py-3 focus:outline-none focus:border-accent transition-colors resize-y font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
                  תגיות (מופרדים בפסיק)
                </label>
                <input
                  value={editing.tags}
                  onChange={(e) => setEditing({ ...editing, tags: e.target.value })}
                  placeholder="פנסיה, חידושים"
                  className="w-full bg-background border border-border px-4 py-3 focus:outline-none focus:border-accent transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
                  תמונת שער
                </label>
                <label className="relative flex items-center justify-center h-12 border border-dashed border-border cursor-pointer hover:border-accent transition-colors overflow-hidden">
                  {preview ? (
                    <span className="text-xs text-muted-foreground">
                      תמונה נבחרה — לחצו להחלפה
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Upload size={16} /> בחירת תמונה
                    </span>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onFile}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </label>
              </div>
              <div className="md:col-span-2 flex items-center gap-3">
                {publishes ? (
                <button
                  type="button"
                  onClick={() =>
                    setEditing({ ...editing, published: !editing.published })
                  }
                  className={`inline-flex items-center gap-2 px-4 py-2 border text-sm transition-colors ${
                    editing.published
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:border-accent"
                  }`}
                >
                  {editing.published ? <Eye size={16} /> : <EyeOff size={16} />}
                  {editing.published ? "פורסם" : "טיוטה"}
                </button>
                ) : (
                  <span className="text-sm text-muted-foreground">טיוטה — הפרסום אצל מנהלי הסוכנות</span>
                )}
                <button
                  onClick={save}
                  disabled={busy || !editing.title || !editing.body || Boolean(slugError)}
                  className={ctaClass()}
                >
                  {busy ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Save size={16} />
                  )}{" "}
                  שמירה
                </button>
              </div>
            </div>
          </div>
        )}

        {takedownNote && (
          <p role="status" className="mb-6 text-sm text-accent">
            דף המאמר הציבורי יוסר בעדכון הבא של האתר (הלילה). להסרה מיידית — פנו לבעל האתר
            (ההוראות ב-README, "Taking an article down now").
          </p>
        )}

        {writeError && (
          <p role="alert" className="mb-6 text-sm text-destructive">
            {writeError}
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-accent" />
          </div>
        ) : isError ? (
          <div className="text-center py-16 border border-dashed border-border text-destructive">
            לא הצלחנו לטעון את המאמרים. ניתן לרענן את הדף.
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border text-muted-foreground">
            אין מאמרים עדיין.
          </div>
        ) : (
          <div className="border border-border/60 divide-y divide-border/60">
            {posts.map((p) => (
              <div key={p.id} className="flex items-center gap-4 p-4">
                <div className="w-16 h-16 shrink-0 overflow-hidden bg-secondary border border-border">
                  {p.image_url ? (
                    <Image
                      src={p.image_url}
                      alt=""
                      className="w-full h-full object-cover"
                      fittingType="fill"
                    />
                  ) : null}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading text-lg truncate">{p.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(p.created_date).toLocaleDateString("he-IL")} ·{" "}
                    {p.published ? "פורסם" : "טיוטה"}
                  </p>
                </div>
                {publishes ? (
                  <button
                    onClick={() => togglePublished(p)}
                    className="text-muted-foreground hover:text-accent transition-colors"
                    aria-label="החלפת פרסום"
                  >
                    {p.published ? <Eye size={18} /> : <EyeOff size={18} />}
                  </button>
                ) : null}
                {publishes || !p.published ? (
                  <button
                    onClick={() => startEdit(p)}
                    className="text-muted-foreground hover:text-accent transition-colors"
                    aria-label="עריכה"
                  >
                    <Pencil size={18} />
                  </button>
                ) : null}
                {deletes ? (
                  <button
                    onClick={() => remove(p)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    aria-label="מחיקה"
                  >
                    <Trash2 size={18} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}