import React, { useState } from "react";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { inputClass } from "@/components/dorit/primitives/Field";
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
import { TOPICS, type TopicId, topicOf } from "@/config/blog-topics";
import { readingMinutes } from "@/lib/reading-time";
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
  Search,
  ExternalLink,
  FileText,
  CircleCheck,
  FilePen,
  Calendar,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

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

  const [query, setQuery] = useState<string>("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [topic, setTopic] = useState<TopicId>("all");

  const posts: BlogPostItem[] = data ?? [];
  const publishedCount = posts.filter((p) => p.published).length;
  const draftCount = posts.length - publishedCount;
  const q = query.trim().toLowerCase();
  const shown = posts.filter(
    (p) =>
      (status === "all" || (status === "published") === !!p.published) &&
      (topic === "all" || topicOf(p.tags) === topic) &&
      (!q || p.title.toLowerCase().includes(q) || (p.tags ?? "").toLowerCase().includes(q)),
  );
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
    // Kept as a literal object: tests/contract/frontend-payloads reads its keys.
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
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="flex items-center gap-3 font-heading font-extrabold text-3xl md:text-4xl">
              ניהול בלוג
              {!loading && !isError ? (
                <span className="rounded-lg bg-highlight/10 px-2.5 py-0.5 text-sm font-semibold text-accent">
                  {posts.length} מאמרים
                </span>
              ) : null}
            </h1>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href="/blog" target="_blank" rel="noopener noreferrer" className={ctaClass(undefined, { muted: true })}>
              <ExternalLink size={18} aria-hidden="true" /> צפייה באתר
            </a>
            <button onClick={startNew} className={ctaClass()}>
              <Plus size={18} /> מאמר חדש
            </button>
          </div>
        </div>

        {!loading && !isError && posts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <Stat icon={FileText} label='סה"כ מאמרים' value={posts.length} />
            <Stat
              icon={CircleCheck}
              label="מאמרים מפורסמים"
              value={publishedCount}
              chip={`${Math.round((publishedCount / posts.length) * 100)}% מהמאמרים`}
              tone="success"
            />
            <Stat icon={FilePen} label="טיוטות" value={draftCount} chip={draftCount ? "ממתינות לעריכה" : undefined} />
          </div>
        ) : null}

        {editing && (
          <div className="mb-10 card-raised p-6 md:p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-heading font-bold text-2xl">
                {editing.id ? "עריכת מאמר" : "מאמר חדש"}
              </h2>
              <button
                onClick={cancel}
                className="w-10 h-10 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                aria-label="סגירה"
              >
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="md:col-span-2">
                <label className={LABEL}>
                  כותרת *
                </label>
                <input
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  className={inputClass()}
                />
              </div>
              <div className="md:col-span-2">
                <label
                  htmlFor="blog-slug"
                  className={LABEL}
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
                  className={inputClass("font-mono text-sm")}
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
                <label className={LABEL}>
                  תקציר
                </label>
                <textarea
                  value={editing.excerpt}
                  onChange={(e) =>
                    setEditing({ ...editing, excerpt: e.target.value })
                  }
                  rows={2}
                  className={inputClass("resize-none")}
                />
              </div>
              <div className="md:col-span-2">
                <label className={LABEL}>
                  תוכן (Markdown) *
                </label>
                <textarea
                  value={editing.body}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  rows={10}
                  className={inputClass("resize-y font-mono text-sm")}
                />
              </div>
              <div>
                <label className={LABEL}>
                  תגיות (מופרדים בפסיק)
                </label>
                <input
                  value={editing.tags}
                  onChange={(e) => setEditing({ ...editing, tags: e.target.value })}
                  placeholder="פנסיה, חידושים"
                  className={inputClass()}
                />
              </div>
              <div>
                <label className={LABEL}>
                  תמונת שער
                </label>
                <label className="relative flex items-center justify-center min-h-12 rounded-xl border-2 border-dashed border-border bg-secondary/40 cursor-pointer hover:border-accent transition-colors overflow-hidden">
                  {preview ? (
                    <span className="text-sm text-muted-foreground">
                      תמונה נבחרה — לחצו להחלפה
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
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
              <div className="md:col-span-2 flex items-center gap-3 pt-2">
                {publishes ? (
                <button
                  type="button"
                  onClick={() =>
                    setEditing({ ...editing, published: !editing.published })
                  }
                  className={`inline-flex items-center gap-2 min-h-12 px-4 rounded-xl border text-sm font-semibold transition-colors ${
                    editing.published
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border hover:border-accent"
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
          <p role="status" className="mb-6 rounded-xl border border-highlight/25 bg-highlight/10 px-4 py-3 text-sm text-accent">
            דף המאמר הציבורי יוסר בעדכון הבא של האתר (הלילה). להסרה מיידית — פנו לבעל האתר
            (ההוראות ב-README, "Taking an article down now").
          </p>
        )}

        {writeError && (
          <p role="alert" className="mb-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {writeError}
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-accent" />
          </div>
        ) : isError ? (
          <div className="text-center py-16 rounded-2xl border-2 border-dashed border-border text-destructive">
            לא הצלחנו לטעון את המאמרים. ניתן לרענן את הדף.
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border-2 border-dashed border-border text-muted-foreground">
            אין מאמרים עדיין.
          </div>
        ) : (
          <>
            {/* Filters: status, topic and a search, all on the list already loaded. */}
            <div className="card-raised p-3 mb-4 flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="relative lg:w-80 shrink-0">
                <label htmlFor="blog-admin-search" className="sr-only">חיפוש מאמרים</label>
                <Search size={16} aria-hidden="true" className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  id="blog-admin-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="חיפוש לפי כותרת או תגית…"
                  className={inputClass("min-h-11 pr-10 text-[15px] bg-secondary/50 shadow-none")}
                />
              </div>
              <div role="group" aria-label="סינון לפי סטטוס" className="flex flex-wrap gap-2">
                {STATUSES.map(({ id, label }) => (
                  <Pill key={id} active={status === id} onClick={() => setStatus(id)}>
                    {label} ({id === "all" ? posts.length : id === "published" ? publishedCount : draftCount})
                  </Pill>
                ))}
              </div>
              <div role="group" aria-label="סינון לפי נושא" className="flex flex-wrap gap-2 lg:border-s lg:border-border lg:ps-3">
                {TOPICS.filter((t) => t.id !== "all").map((t) => (
                  <Pill key={t.id} active={topic === t.id} onClick={() => setTopic(topic === t.id ? "all" : t.id)}>
                    {t.label}
                  </Pill>
                ))}
              </div>
            </div>

            {shown.length === 0 ? (
              <div className="text-center py-14 rounded-2xl border-2 border-dashed border-border text-muted-foreground">
                אין מאמרים שתואמים את הסינון.
              </div>
            ) : (
              <ul className="card-raised overflow-hidden divide-y divide-border">
                {shown.map((p) => {
                  const t = topicOf(p.tags);
                  const topicLabel = t ? TOPIC_LABEL[t] : undefined;
                  return (
                    <li key={p.id} className="flex items-center gap-4 p-4 md:px-5 hover:bg-secondary/40 transition-colors">
                      <div className="w-16 h-16 md:w-20 md:h-20 shrink-0 overflow-hidden rounded-xl bg-secondary border border-border">
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
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {topicLabel ? (
                            <span className="rounded-md bg-highlight/10 px-2 py-0.5 font-semibold text-accent">{topicLabel}</span>
                          ) : null}
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-semibold ${
                              p.published ? "bg-[hsl(var(--brand-whatsapp)/0.12)] text-[hsl(142_70%_28%)] dark:text-[hsl(142_60%_60%)]" : "bg-secondary text-muted-foreground"
                            }`}
                          >
                            <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${p.published ? "bg-[hsl(var(--brand-whatsapp))]" : "bg-muted-foreground"}`} />
                            {p.published ? "פורסם" : "טיוטה"}
                          </span>
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Calendar size={13} aria-hidden="true" />
                            {new Date(p.created_date).toLocaleDateString("he-IL")}
                          </span>
                        </div>
                        <p className="mt-1.5 font-heading font-bold text-[17px] md:text-lg leading-snug truncate">{p.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">קריאה: כ־{readingMinutes(p.body)} דק׳</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {p.published ? (
                          <a
                            href={articlePath(p)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={ACTION}
                            aria-label="צפייה במאמר באתר"
                            title="צפייה במאמר באתר"
                          >
                            <ExternalLink size={18} />
                          </a>
                        ) : null}
                        {publishes ? (
                          <button
                            onClick={() => togglePublished(p)}
                            className={ACTION}
                            aria-label="החלפת פרסום"
                            title={p.published ? "העברה לטיוטה" : "פרסום"}
                          >
                            {p.published ? <Eye size={18} /> : <EyeOff size={18} />}
                          </button>
                        ) : null}
                        {publishes || !p.published ? (
                          <button
                            onClick={() => startEdit(p)}
                            className={ACTION}
                            aria-label="עריכה"
                            title="עריכה"
                          >
                            <Pencil size={18} />
                          </button>
                        ) : null}
                        {deletes ? (
                          <button
                            onClick={() => remove(p)}
                            className={`${ACTION} hover:!text-destructive hover:!bg-destructive/10`}
                            aria-label="מחיקה"
                            title="מחיקה"
                          >
                            <Trash2 size={18} />
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type StatusFilter = "all" | "published" | "draft";

const TOPIC_LABEL = Object.fromEntries(TOPICS.map((t) => [t.id, t.label])) as Record<TopicId, string>;

const STATUSES: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "הכל" },
  { id: "published", label: "מפורסם" },
  { id: "draft", label: "טיוטה" },
];

const LABEL = "block text-sm font-medium text-foreground/80 mb-2";

const ACTION =
  "w-10 h-10 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-accent transition-colors";

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-9 px-3.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-foreground/75 hover:bg-secondary"
      }`}
    >
      {children}
    </button>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  chip,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  chip?: string;
  tone?: "success";
}) {
  return (
    <div className="card-raised p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center text-accent" aria-hidden="true">
          <Icon size={20} />
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <span className="font-heading font-extrabold text-4xl leading-none lining-nums tabular-nums">{value}</span>
        {chip ? (
          <span
            className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
              tone === "success" ? "bg-[hsl(var(--brand-whatsapp)/0.12)] text-[hsl(142_70%_28%)] dark:text-[hsl(142_60%_60%)]" : "bg-secondary text-muted-foreground"
            }`}
          >
            {chip}
          </span>
        ) : null}
      </div>
    </div>
  );
}
