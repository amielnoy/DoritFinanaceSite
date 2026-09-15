import React, { useEffect, useState } from "react";
import { services, type LeadRecord, type LeadSource, type LeadStatus } from "@/services";
import { Link } from "react-router-dom";
import { Loader2, Download, Trash2, ArrowRight } from "lucide-react";

type LeadItem = LeadRecord;

/* The statuses an admin may set. `escalated` and `partial` are written by the
   backend and are not offered here — an admin moves such a lead on to
   "contacted" or "closed" rather than back into them. */
const STATUS: LeadStatus[] = ["new", "contacted", "closed"];
const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "חדשה",
  contacted: "טופלה",
  closed: "נסגרה",
};
/* Display labels for every status the entity can hold, settable or not. Without
   the backend-written ones a lead rendered with its raw English key. */
const ANY_STATUS_LABEL: Record<string, string> = {
  ...STATUS_LABEL,
  escalated: "הועברה לטיפול אישי",
  partial: "ראיון שלא הושלם",
};
const STATUS_COLOR: Record<LeadStatus, string> = {
  new: "bg-highlight/15 text-[#8a6f54]",
  contacted: "bg-accent/15 text-accent",
  closed: "bg-muted text-muted-foreground",
};
/* Every value the Lead entity's `source` enum can hold. `escalation` was missing
   while this screen kept its own narrower copy of the type, so a lead handed over
   by an agent rendered with its raw English key. */
const SOURCE_LABEL: Record<LeadSource, string> = {
  consultation: "בנאי ייעוץ",
  detailed: "טופס מפורט",
  quick: "פנייה מהירה",
  claim: "דיווח תביעה",
  escalation: "העברה לטיפול אנושי",
  interview: "ראיון היכרות",
};

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function Leads() {
  const [leads, setLeads] = useState<LeadItem[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState<boolean>(false);

  const load = async () => {
    setLoading(true);
    try {
      setLeads(await services.leadsAdmin.list());
    } catch {
      setLeads([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = (leads || []).filter((l) => filter === "all" || l.status === filter);

  const exportCsv = (all: boolean) => {
    const source = all ? (leads || []) : filtered;
    const headers = ["תאריך", "שם", "טלפון", "אימייל", "מקור", "תחום/שירות", "מועד", "סטטוס", "הודעה"];
    const rows = source.map((l) => [
      l.created_date ? new Date(l.created_date).toLocaleString("he-IL") : "",
      l.name,
      l.phone,
      l.email || "",
      SOURCE_LABEL[l.source] || l.source || "",
      l.topic || "",
      l.timing || "",
      ANY_STATUS_LABEL[l.status] || l.status || "",
      l.message || "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}${all ? "-all" : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const updateStatus = async (id: string, status: LeadStatus) => {
    setBusy(true);
    try {
      await services.leadsAdmin.setStatus(id, status);
      setLeads((ls) => (ls || []).map((l) => (l.id === id ? { ...l, status } : l)));
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("למחוק את הפנייה?")) return;
    setBusy(true);
    try {
      await services.leadsAdmin.remove(id);
      setLeads((ls) => (ls || []).filter((l) => l.id !== id));
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const counts = (leads || []).reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="max-w-[1200px] mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-[11px] tracking-[0.3em] uppercase text-accent">Admin</p>
            <h1 className="font-heading text-2xl md:text-3xl mt-1">ניהול פניות</h1>
          </div>
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-foreground/60 hover:text-accent transition-colors"
          >
            חזרה לאתר <ArrowRight size={16} />
          </Link>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-6 py-8">
        {/* תצוגת סיכום סטטוסים */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <button
            onClick={() => setFilter("all")}
            className={`text-right p-5 border transition-colors ${filter === "all" ? "border-primary bg-primary/[0.03]" : "border-border/60 hover:border-accent/50 bg-card"}`}
          >
            <p className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground">סה״כ פניות</p>
            <p className="font-heading text-3xl mt-2">{(leads || []).length}</p>
            <p className="text-xs text-foreground/50 mt-1">כל הרשומות במערכת</p>
          </button>
          <button
            onClick={() => setFilter("new")}
            className={`text-right p-5 border transition-colors ${filter === "new" ? "border-highlight bg-highlight/10" : "border-border/60 hover:border-highlight/50 bg-card"}`}
          >
            <p className="text-[11px] tracking-[0.2em] uppercase text-[#8a6f54]">דורשות טיפול</p>
            <p className="font-heading text-3xl mt-2 text-[#8a6f54]">{counts.new || 0}</p>
            <p className="text-xs text-foreground/50 mt-1">לקוחות חדשים — ליצור קשר</p>
          </button>
          <button
            onClick={() => setFilter("contacted")}
            className={`text-right p-5 border transition-colors ${filter === "contacted" ? "border-accent bg-accent/10" : "border-border/60 hover:border-accent/50 bg-card"}`}
          >
            <p className="text-[11px] tracking-[0.2em] uppercase text-accent">בתהליך</p>
            <p className="font-heading text-3xl mt-2 text-accent">{counts.contacted || 0}</p>
            <p className="text-xs text-foreground/50 mt-1">נוצר קשר — להמשיך במכירה</p>
          </button>
          <button
            onClick={() => setFilter("closed")}
            className={`text-right p-5 border transition-colors ${filter === "closed" ? "border-primary bg-primary/[0.03]" : "border-border/60 hover:border-accent/50 bg-card"}`}
          >
            <p className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground">נסגרו</p>
            <p className="font-heading text-3xl mt-2 text-muted-foreground">{counts.closed || 0}</p>
            <p className="text-xs text-foreground/50 mt-1">טופלו והסתיימו</p>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex flex-wrap items-center gap-2">
            {["all", ...STATUS].map((s) => {
              const active = filter === s;
              const label = s === "all" ? "הכל" : STATUS_LABEL[s as LeadStatus];
              const count = s === "all" ? (leads || []).length : counts[s] || 0;
              return (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`px-4 py-2 text-sm border transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:border-accent"
                  }`}
                >
                  {label} <span className="opacity-60">({count})</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCsv(false)}
              disabled={!filtered.length}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-border text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-40 transition-colors"
            >
              <Download size={15} /> ייצוא מסונן
            </button>
            <button
              onClick={() => exportCsv(true)}
              disabled={!leads?.length}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-accent-foreground font-medium hover:bg-accent/90 disabled:opacity-40 transition-colors"
            >
              <Download size={16} /> ייצוא הכל ל-CSV
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-accent" size={28} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-border">
            <p className="text-foreground/60">אין פניות להצגה.</p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-muted-foreground">
                <tr className="text-right">
                  <th className="px-4 py-3 font-medium">תאריך</th>
                  <th className="px-4 py-3 font-medium">שם</th>
                  <th className="px-4 py-3 font-medium">טלפון</th>
                  <th className="px-4 py-3 font-medium">אימייל</th>
                  <th className="px-4 py-3 font-medium">מקור</th>
                  <th className="px-4 py-3 font-medium">פרטים</th>
                  <th className="px-4 py-3 font-medium">סטטוס</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} className="border-t border-border/60 align-top">
                    <td className="px-4 py-3 text-foreground/60 whitespace-nowrap">
                      {l.created_date ? new Date(l.created_date).toLocaleDateString("he-IL") : "—"}
                    </td>
                    <td className="px-4 py-3 font-medium">{l.name}</td>
                    <td className="px-4 py-3" dir="ltr">{l.phone}</td>
                    <td className="px-4 py-3 text-foreground/70" dir="ltr">{l.email || "—"}</td>
                    <td className="px-4 py-3 text-foreground/70">{SOURCE_LABEL[l.source] || "—"}</td>
                    <td className="px-4 py-3 text-foreground/70 max-w-xs">
                      {[l.topic, l.timing, l.message].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-1 text-xs ${STATUS_COLOR[l.status] || ""}`}>
                        {ANY_STATUS_LABEL[l.status] || l.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={l.status}
                          onChange={(e) => updateStatus(l.id, e.target.value as LeadStatus)}
                          disabled={busy}
                          className="text-xs border border-border bg-background px-2 py-1 focus:outline-none focus:border-accent"
                        >
                          {STATUS.map((s) => (
                            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => remove(l.id)}
                          disabled={busy}
                          className="text-foreground/40 hover:text-destructive transition-colors disabled:opacity-30"
                          aria-label="מחיקה"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}