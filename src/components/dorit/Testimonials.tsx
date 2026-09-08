import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Image } from "@/components/ui/image";
import { Plus, X, Quote, Trash2, Loader2, Upload } from "lucide-react";
import Reveal from "@/components/dorit/Reveal";
import Stars from "@/components/dorit/Stars";

interface TestimonialItem {
  id: string;
  name: string;
  role?: string;
  quote: string;
  image_url?: string;
  rating?: number;
  source?: string;
}

interface TestimonialForm {
  name: string;
  role: string;
  quote: string;
  image_url: string;
  rating: number;
  source: string;
}

export default function Testimonials() {
  const { isAuthenticated } = useAuth();
  const [items, setItems] = useState<TestimonialItem[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [open, setOpen] = useState<boolean>(false);
  const [form, setForm] = useState<TestimonialForm>({ name: "", role: "", quote: "", image_url: "", rating: 5, source: "google" });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.Testimonial.list("-created_date", 50);
      setItems(data as unknown as TestimonialItem[]);
    } catch {
      setItems([]);
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

  const reset = () => {
    setForm({ name: "", role: "", quote: "", image_url: "", rating: 5, source: "google" });
    setFile(null);
    setPreview("");
    setOpen(false);
  };

  const submit = async () => {
    if (!form.name || !form.quote) return;
    setBusy(true);
    try {
      let image_url = form.image_url;
      if (file) {
        const res = await base44.integrations.Core.UploadFile({ file });
        image_url = res.file_url;
      }
      await base44.entities.Testimonial.create({
        name: form.name,
        role: form.role,
        quote: form.quote,
        image_url,
        rating: Number(form.rating) || 5,
        source: form.source || "google",
      });
      reset();
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await base44.entities.Testimonial.delete(id);
    load();
  };

  return (
    <section id="testimonials" className="relative py-24 md:py-32 border-t border-border/60 bg-secondary/40">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-14">
          <div>
            <Reveal>
              <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
                05 · Clients Speak
              </span>
              <h2 className="font-heading text-5xl md:text-6xl mt-4">לקוחות מספרים</h2>
            </Reveal>
          </div>
          {isAuthenticated && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-2 px-6 py-3 border border-border hover:bg-primary hover:text-primary-foreground transition-colors text-sm"
            >
              {open ? <X size={16} /> : <Plus size={16} />}
              {open ? "סגירת טופס" : "הוספת המלצה"}
            </button>
          )}
        </div>

        {/* Add form */}
        {isAuthenticated && open && (
          <div className="mb-12 bg-card border border-border/60 p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="md:col-span-1">
                <label className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">
                  תמונת הממליץ/ה
                </label>
                <label className="relative flex items-center justify-center h-44 border border-dashed border-border cursor-pointer hover:border-accent transition-colors overflow-hidden">
                  {preview ? (
                    <img src={preview} alt="תצוגה מקדימה" className="w-full h-full object-cover" />
                  ) : (
                    <span className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Upload size={22} />
                      <span className="text-xs">בחר/י תמונה</span>
                    </span>
                  )}
                  <input type="file" accept="image/*" onChange={onFile} className="absolute inset-0 opacity-0 cursor-pointer" />
                </label>
              </div>
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-5 content-start">
                <div>
                  <label className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">שם מלא *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full bg-background border border-border px-4 py-3 focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">הקשר</label>
                  <input
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                    placeholder="לקוחה מאז 2019"
                    className="w-full bg-background border border-border px-4 py-3 focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">ציטוט *</label>
                  <textarea
                    value={form.quote}
                    onChange={(e) => setForm((f) => ({ ...f, quote: e.target.value }))}
                    rows={3}
                    className="w-full bg-background border border-border px-4 py-3 focus:outline-none focus:border-accent transition-colors resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">דירוג</label>
                  <select
                    value={form.rating}
                    onChange={(e) => setForm((f) => ({ ...f, rating: Number(e.target.value) }))}
                    className="w-full bg-background border border-border px-4 py-3 focus:outline-none focus:border-accent transition-colors"
                  >
                    {[5, 4, 3, 2, 1].map((r) => (
                      <option key={r} value={r}>{r} כוכבים</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2">מקור חוות דעת</label>
                  <select
                    value={form.source}
                    onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                    className="w-full bg-background border border-border px-4 py-3 focus:outline-none focus:border-accent transition-colors"
                  >
                    <option value="google">Google</option>
                    <option value="midrag">Midrag</option>
                  </select>
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <button
                    onClick={submit}
                    disabled={busy || !form.name || !form.quote}
                    className="inline-flex items-center gap-2 px-7 py-3 bg-primary text-primary-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-primary transition-colors"
                  >
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                    פרסום המלצה
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-accent" />
          </div>
        ) : !items || items.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-border">
            <Quote size={28} className="mx-auto text-[#C4A484] mb-4" strokeWidth={1.25} />
            <p className="text-foreground/60">
              {isAuthenticated ? "עדיין אין המלצות — הוספ/י את הראשונה." : "בקרוב יעלו כאן המלצות הלקוחות."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((t) => (
              <article key={t.id} className="group relative bg-card border border-border/60 p-7 flex flex-col">
                {isAuthenticated && (
                  <button
                    onClick={() => remove(t.id)}
                    className="absolute top-4 left-4 text-muted-foreground hover:text-destructive transition-colors"
                    aria-label="מחיקה"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                <div className="flex items-center gap-4 mb-5">
                  <div className="w-14 h-14 rounded-full overflow-hidden border border-border bg-secondary shrink-0">
                    {t.image_url ? (
                      <Image src={t.image_url} alt={t.name} className="w-full h-full object-cover" fittingType="fill" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-accent font-heading text-xl">
                        {t.name?.charAt(0) || "·"}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="font-heading text-lg leading-tight">{t.name}</p>
                    {t.role && <p className="text-xs tracking-[0.1em] uppercase text-muted-foreground mt-1">{t.role}</p>}
                    <div className="flex items-center gap-2 mt-2">
                      {t.rating ? <Stars value={t.rating} /> : null}
                      {t.source && (
                        <span className="text-[10px] tracking-[0.15em] uppercase px-2 py-0.5 border border-border text-muted-foreground">
                          {t.source === "google" ? "Google" : "Midrag"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Quote size={18} className="text-[#C4A484] mb-3" strokeWidth={1.25} />
                <p className="text-foreground/80 leading-relaxed flex-1">{t.quote}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}