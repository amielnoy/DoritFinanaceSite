import React, { useState } from "react";
import { services, type Testimonial } from "@/services";
import { useAuth } from "@/lib/AuthContext";
import { useTestimonials } from "@/hooks/useContent";
import { useCreateTestimonial, useRemoveTestimonial } from "@/hooks/useAdmin";
import { Image } from "@/components/ui/image";
import { Plus, X, Quote, Trash2, Loader2, Upload } from "lucide-react";
import Reveal from "@/components/dorit/primitives/Reveal";
import Stars from "@/components/dorit/primitives/Stars";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { inputClass } from "@/components/dorit/primitives/Field";

type TestimonialItem = Testimonial;

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
  const { data, isPending: loading } = useTestimonials();
  const createTestimonial = useCreateTestimonial();
  const removeTestimonial = useRemoveTestimonial();
  const [open, setOpen] = useState<boolean>(false);
  const [form, setForm] = useState<TestimonialForm>({ name: "", role: "", quote: "", image_url: "", rating: 5, source: "google" });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [uploading, setUploading] = useState<boolean>(false);

  const items: TestimonialItem[] = data ?? [];
  const busy = uploading || createTestimonial.isPending;

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
    let image_url = form.image_url;
    if (file) {
      setUploading(true);
      try {
        ({ url: image_url } = await services.uploads.upload(file));
      } catch {
        return;
      } finally {
        setUploading(false);
      }
    }
    try {
      await createTestimonial.mutateAsync({
        name: form.name,
        role: form.role,
        quote: form.quote,
        image_url,
        rating: form.rating,
        source: form.source,
      });
      reset();
    } catch {
      /* the mutation's isError drives the notice below */
    }
  };

  const remove = (id: string) => removeTestimonial.mutate(id);

  // The section exists only when there is something to show. Nothing while the
  // list loads (so it cannot flash in and out) and nothing when it is empty —
  // the home page carries no "coming soon" placeholder. The signed-in owner is
  // the exception once loaded: the add form lives here, and without the section
  // the first testimonial could never be added.
  if (loading || (items.length === 0 && !isAuthenticated)) return null;

  return (
    <section id="testimonials" className="relative bg-secondary border-b border-border">
      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-[clamp(72px,9vw,120px)] flex flex-col gap-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Reveal>
              <Eyebrow>
                05 · לקוחות מספרים
              </Eyebrow>
              <h2 className="font-heading font-normal text-[clamp(34px,4vw,48px)] leading-[1.12] mt-[18px]">לקוחות מספרים</h2>
            </Reveal>
          </div>
          {isAuthenticated && (
            <button
              onClick={() => setOpen((v) => !v)}
              className={ctaClass("text-[15px]", { muted: true })}
            >
              {open ? <X size={16} /> : <Plus size={16} />}
              {open ? "סגירת טופס" : "הוספת המלצה"}
            </button>
          )}
        </div>

        {/* Add form */}
        {isAuthenticated && open && (
          <div className="border border-border rounded-md p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="md:col-span-1">
                <label className="block text-[15px] text-foreground/80 mb-1.5">
                  תמונת הממליץ/ה
                </label>
                <label className="relative flex items-center justify-center h-44 border border-dashed border-border cursor-pointer rounded-md hover:border-highlight transition-colors duration-200 overflow-hidden">
                  {preview ? (
                    <img src={preview} alt="תצוגה מקדימה" className="w-full h-full object-cover" />
                  ) : (
                    <span className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Upload size={22} />
                      <span className="text-sm">בחר/י תמונה</span>
                    </span>
                  )}
                  <input type="file" accept="image/*" onChange={onFile} className="absolute inset-0 opacity-0 cursor-pointer" />
                </label>
              </div>
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-5 content-start">
                <div>
                  <label className="block text-[15px] text-foreground/80 mb-1.5">שם מלא *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className={inputClass()}
                  />
                </div>
                <div>
                  <label className="block text-[15px] text-foreground/80 mb-1.5">הקשר</label>
                  <input
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                    placeholder="לקוחה מאז 2019"
                    className={inputClass()}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[15px] text-foreground/80 mb-1.5">ציטוט *</label>
                  <textarea
                    value={form.quote}
                    onChange={(e) => setForm((f) => ({ ...f, quote: e.target.value }))}
                    rows={3}
                    className={inputClass("resize-none")}
                  />
                </div>
                <div>
                  <label className="block text-[15px] text-foreground/80 mb-1.5">דירוג</label>
                  <select
                    value={form.rating}
                    onChange={(e) => setForm((f) => ({ ...f, rating: Number(e.target.value) }))}
                    className={inputClass()}
                  >
                    {[5, 4, 3, 2, 1].map((r) => (
                      <option key={r} value={r}>{r} כוכבים</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[15px] text-foreground/80 mb-1.5">מקור חוות דעת</label>
                  <select
                    value={form.source}
                    onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                    className={inputClass()}
                  >
                    <option value="google">Google</option>
                    <option value="midrag">Midrag</option>
                  </select>
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <button
                    onClick={submit}
                    disabled={busy || !form.name || !form.quote}
                    className={ctaClass()}
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
        {items.length === 0 ? (
          <div className="border-y border-border py-14 px-6 flex flex-col items-center gap-3 text-center">
            <span aria-hidden="true" className="font-heading text-[64px] leading-[0.6] text-highlight">”</span>
            <p className="text-[17px] text-muted-foreground">
              עדיין אין המלצות — הוספ/י את הראשונה.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((t) => (
              <article key={t.id} className="group relative rounded-md border border-border p-7 flex flex-col">
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
                    {t.role && <p className="text-sm text-muted-foreground mt-1">{t.role}</p>}
                    <div className="flex items-center gap-2 mt-2">
                      {t.rating ? <Stars value={t.rating} /> : null}
                      {t.source && (
                        <span className="text-sm px-2 py-0.5 border border-border text-muted-foreground">
                          {t.source === "google" ? "Google" : "Midrag"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Quote size={18} className="text-highlight mb-3" strokeWidth={1.25} />
                <p className="text-foreground/80 leading-relaxed flex-1">{t.quote}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}