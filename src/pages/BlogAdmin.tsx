import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";
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
  ArrowRight,
} from "lucide-react";

interface BlogPostItem {
  id: string;
  title: string;
  excerpt?: string;
  body: string;
  image_url?: string;
  tags?: string;
  published: boolean;
  created_date: string;
}

interface BlogPostEdit {
  id?: string;
  title: string;
  excerpt: string;
  body: string;
  image_url: string;
  tags: string;
  published: boolean;
}

const EMPTY: BlogPostEdit = {
  title: "",
  excerpt: "",
  body: "",
  image_url: "",
  tags: "",
  published: false,
};

export default function BlogAdmin() {
  const [posts, setPosts] = useState<BlogPostItem[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [editing, setEditing] = useState<BlogPostEdit | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.BlogPost.list("-created_date", 100);
      setPosts(data as unknown as BlogPostItem[]);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

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
    setEditing({ ...p });
    setFile(null);
    setPreview(p.image_url || "");
  };

  const cancel = () => {
    setEditing(null);
    setFile(null);
    setPreview("");
  };

  const save = async () => {
    if (!editing || !editing.title || !editing.body) return;
    setBusy(true);
    try {
      let image_url = editing.image_url;
      if (file) {
        const res = await base44.integrations.Core.UploadFile({ file });
        image_url = res.file_url;
      }
      const payload = {
        title: editing.title,
        excerpt: editing.excerpt,
        body: editing.body,
        tags: editing.tags,
        published: !!editing.published,
        image_url,
      };
      if (editing.id) {
        await base44.entities.BlogPost.update(editing.id, payload);
      } else {
        await base44.entities.BlogPost.create(payload);
      }
      cancel();
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("למחוק את המאמר?")) return;
    await base44.entities.BlogPost.delete(id);
    load();
  };

  const togglePublished = async (p: BlogPostItem) => {
    await base44.entities.BlogPost.update(p.id, { published: !p.published });
    load();
  };

  return (
    <div className="min-h-screen bg-background pt-28 pb-20">
      <div className="max-w-[1200px] mx-auto px-6 md:px-10">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-foreground/60 hover:text-accent transition-colors mb-8"
        >
          <ArrowRight size={16} /> חזרה לאתר
        </Link>

        <div className="flex items-center justify-between mb-10">
          <div>
            <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
              Admin
            </span>
            <h1 className="font-heading text-4xl md:text-5xl mt-3">ניהול בלוג</h1>
          </div>
          <button
            onClick={startNew}
            className="inline-flex items-center gap-2 px-6 py-3 bg-highlight text-primary font-medium hover:bg-highlight-strong transition-colors"
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
                <button
                  onClick={save}
                  disabled={busy || !editing.title || !editing.body}
                  className="inline-flex items-center gap-2 px-7 py-2.5 bg-highlight text-primary font-medium hover:bg-highlight-strong disabled:opacity-40 transition-colors"
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

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-accent" />
          </div>
        ) : !posts || posts.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border text-foreground/60">
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
                <button
                  onClick={() => togglePublished(p)}
                  className="text-muted-foreground hover:text-accent transition-colors"
                  aria-label="החלפת פרסום"
                >
                  {p.published ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
                <button
                  onClick={() => startEdit(p)}
                  className="text-muted-foreground hover:text-accent transition-colors"
                  aria-label="עריכה"
                >
                  <Pencil size={18} />
                </button>
                <button
                  onClick={() => remove(p.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  aria-label="מחיקה"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}