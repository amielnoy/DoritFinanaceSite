import React, { useEffect, useRef, useState } from "react";
import { services, type Testimonial } from "@/services";
import { useAuth } from "@/lib/AuthContext";
import { useTestimonials } from "@/hooks/useContent";
import { useCreateTestimonial, useRemoveTestimonial } from "@/hooks/useAdmin";
import { Image } from "@/components/ui/image";
import { Plus, X, Quote, Trash2, Loader2, Upload, ArrowLeft, ArrowRight } from "lucide-react";
import Reveal from "@/components/dorit/primitives/Reveal";
import Stars from "@/components/dorit/primitives/Stars";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { inputClass } from "@/components/dorit/primitives/Field";
import { MD_UP, useMediaQuery } from "@/hooks/useMediaQuery";
import { useLocale, useT } from "@/i18n/LocaleContext";
import { AGENCY_1, useAgencyRole } from "@/hooks/useAgency";

type TestimonialItem = Testimonial;

interface TestimonialForm {
  name: string;
  role: string;
  quote: string;
  image_url: string;
  rating: number;
  source: string;
}

/**
 * From md up, a grid. Below md, with more than one testimonial, a strip that
 * scrolls sideways one card at a time (scroll-snap): "ההמלצה הקודמת" and
 * "ההמלצה הבאה" beside the heading are real buttons, the strip itself is a
 * focusable region the arrow keys scroll, and nothing moves on its own. Every
 * card stays in the document — the others are beside it, not removed.
 */
export default function Testimonials() {
  const { isAuthenticated } = useAuth();
  // `tr`, not `t`: each testimonial below is `t`.
  const tr = useT("home");
  const he = useLocale() === "he";
  // Adding and deleting are Admin+ in agency 1 (or the platform operator) —
  // content-admin and the testimonials policy refuse anyone else. Ordinary
  // visitors sign in too, so "signed in" never shows the controls. A public
  // section: the role answer is reused for a few minutes, as the header's is.
  const { can } = useAgencyRole(AGENCY_1, { staleTime: 5 * 60_000 });
  const isAdmin = isAuthenticated && can("testimonials.write");
  const { data, isPending: loading } = useTestimonials();
  const createTestimonial = useCreateTestimonial();
  const removeTestimonial = useRemoveTestimonial();
  const [open, setOpen] = useState<boolean>(false);
  const [form, setForm] = useState<TestimonialForm>({ name: "", role: "", quote: "", image_url: "", rating: 5, source: "google" });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [uploading, setUploading] = useState<boolean>(false);
  /** The picture did not upload: said in the form, beside the mutation's own failure (review 2026-10-15). */
  const [uploadFailed, setUploadFailed] = useState<boolean>(false);
  const isDesktop = useMediaQuery(MD_UP, true);
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState<number>(0);

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
    setUploadFailed(false);
    setOpen(false);
  };

  const submit = async () => {
    if (!form.name || !form.quote) return;
    let image_url = form.image_url;
    setUploadFailed(false);
    if (file) {
      setUploading(true);
      try {
        ({ url: image_url } = await services.uploads.upload(file));
      } catch {
        setUploadFailed(true);
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
      /* the mutation's isError drives the notice in the form */
    }
  };

  // Asked first, as on the leads and the blog screens: a deleted testimonial is gone for good.
  const remove = (id: string) => {
    if (!window.confirm("למחוק את ההמלצה?")) return;
    removeTestimonial.mutate(id);
  };

  const carousel = !isDesktop && items.length > 1;
  // The strip mounts at its first card: when it goes (a wider screen, a
  // deleted testimonial) the position goes with it.
  useEffect(() => {
    if (!carousel) setIndex(0);
  }, [carousel]);
  const at = Math.min(index, items.length - 1);

  /** One card and the gap after it, and which way "on" is (RTL scrolls negative). */
  const geometry = (el: HTMLDivElement) => {
    const first = el.firstElementChild as HTMLElement | null;
    const step = (first?.offsetWidth ?? el.clientWidth) + (parseFloat(getComputedStyle(el).columnGap) || 0);
    const sign = getComputedStyle(el).direction === "rtl" ? -1 : 1;
    return { step, sign };
  };

  const onStripScroll = () => {
    const el = strip.current;
    if (!el) return;
    const { step } = geometry(el);
    const x = Math.abs(el.scrollLeft);
    const atEnd = x >= el.scrollWidth - el.clientWidth - 2;
    setIndex(atEnd ? items.length - 1 : Math.min(items.length - 1, Math.round(x / step)));
  };

  const go = (to: number) => {
    const el = strip.current;
    if (!el || to < 0 || to > items.length - 1) return;
    const { step, sign } = geometry(el);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: sign * to * step, behavior: reduce ? "auto" : "smooth" });
  };

  // The section exists only when there is something to show. Nothing while the
  // list loads (so it cannot flash in and out) and nothing when it is empty —
  // the home page carries no "coming soon" placeholder. An admin is the
  // exception once loaded: the add form lives here, and without the section
  // the first testimonial could never be added.
  if (loading || (items.length === 0 && !isAdmin)) return null;

  return (
    <section id="testimonials" className="relative bg-secondary border-b border-border">
      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-[clamp(72px,9vw,120px)] flex flex-col gap-10 max-md:py-10 max-md:gap-6">
        <div className="flex flex-wrap items-end justify-between gap-6 max-md:gap-4">
          <div className="max-md:min-w-0">
            <Reveal>
              <Eyebrow>
                {tr("testimonials.eyebrow")}
              </Eyebrow>
              <h2 className="font-heading font-normal text-[clamp(34px,4vw,48px)] leading-[1.12] mt-[18px]">{tr("testimonials.title")}</h2>
              {/* The quotes are the clients' own words, in Hebrew; on the English
                  and French pages each card keeps Hebrew's language and direction. */}
              {he ? null : <p className="mt-3 text-[15px] text-muted-foreground">{tr("testimonials.original")}</p>}
            </Reveal>
          </div>
          {carousel && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => go(at - 1)}
                aria-label={tr("testimonials.prev")}
                aria-controls="testimonials-strip"
                aria-disabled={at <= 0}
                className={NAV}
              >
                <ArrowRight size={18} strokeWidth={1.5} aria-hidden="true" className="ltr:rotate-180" />
              </button>
              <button
                type="button"
                onClick={() => go(at + 1)}
                aria-label={tr("testimonials.next")}
                aria-controls="testimonials-strip"
                aria-disabled={at >= items.length - 1}
                className={NAV}
              >
                <ArrowLeft size={18} strokeWidth={1.5} aria-hidden="true" className="ltr:rotate-180" />
              </button>
            </div>
          )}
          {isAdmin && (
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
        {isAdmin && open && (
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
                {(uploadFailed || createTestimonial.isError) && (
                  <p role="alert" className="md:col-span-2 text-sm text-destructive">
                    {uploadFailed ? "התמונה לא הועלתה. ניתן לנסות שוב, או לפרסם בלי תמונה." : "ההמלצה לא נשמרה. ניתן לנסות שוב."}
                  </p>
                )}
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

        {isAdmin && removeTestimonial.isError && (
          <p role="alert" className="mb-6 text-sm text-destructive">
            ההמלצה לא נמחקה. ניתן לנסות שוב.
          </p>
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
          <div
            className={carousel ? STRIP : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"}
            {...(carousel
              ? {
                  ref: strip,
                  id: "testimonials-strip",
                  // A strip that scrolls needs a keyboard way in (axe:
                  // scrollable-region-focusable), as the cases' strip has.
                  tabIndex: 0,
                  role: "region",
                  "aria-label": tr("testimonials.region"),
                  onScroll: onStripScroll,
                }
              : {})}
          >
            {items.map((t, i) => (
              <article
                key={t.id}
                aria-label={carousel ? tr("testimonials.item", { n: i + 1, total: items.length }) : undefined}
                {...(he ? {} : { lang: "he", dir: "rtl" })}
                className={carousel ? "group relative rounded-md border border-border p-5 flex flex-col shrink-0 w-[88%] snap-start" : "group relative rounded-md border border-border p-7 flex flex-col"}
              >
                {isAdmin && (
                  <button
                    onClick={() => remove(t.id)}
                    className="absolute top-4 left-4 text-muted-foreground hover:text-destructive transition-colors"
                    aria-label="מחיקה"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                <div className={`flex items-center gap-4 ${carousel ? "mb-4" : "mb-5"}`}>
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

const NAV =
  "w-11 h-11 rounded-md border border-border flex items-center justify-center text-foreground hover:border-highlight hover:text-accent transition-colors duration-200 aria-disabled:opacity-40 aria-disabled:cursor-default";

const STRIP =
  "flex gap-4 overflow-x-auto snap-x snap-mandatory -mx-[clamp(20px,4vw,40px)] px-[clamp(20px,4vw,40px)] scroll-px-[clamp(20px,4vw,40px)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight";
