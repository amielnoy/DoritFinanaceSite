import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { Loader2, Download, Trash2, ArrowRight } from "lucide-react";

const STATUS = ["new", "contacted", "closed"];
const STATUS_LABEL = { new: "חדשה", contacted: "טופלה", closed: "נסגרה" };
const STATUS_COLOR = {
  new: "bg-[#C4A484]/15 text-[#8a6f54]",
  contacted: "bg-accent/15 text-accent",
  closed: "bg-muted text-muted-foreground",
};
const SOURCE_LABEL = { consultation: "בנאי ייעוץ", detailed: "טופס מפורט", quick: "פנייה מהירה" };

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function Leads() {
  const [leads, setLeads] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.Lead.list("-created_date", 500);
      setLeads(data || []);
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

  const exportCsv = () => {
    const headers = ["תאריך", "שם", "טלפון", "אימייל", "מקור", "תחום/שירות", "מועד", "סטטוס", "הודעה"];
    const rows = filtered.map((l) => [
      l.created_date ? new Date(l.created_date).toLocaleString("he-IL") : "",
      l.name,
      l.phone,
      l.email || "",
      SOURCE_LABEL[l.source] || l.source || "",
      l.topic || "",
      l.timing || "",
      STATUS_LABEL[l.status] || l.status || "",
      l.message || "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const updateStatus = async (id, status) => {
    setBusy(true);
    try {
      await base44.entities.Lead.update(id, { status });
      setLeads((ls) => (ls || []).map((l) => (l.id === id ? { ...l, status } : l)));
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm("למחוק את הפנייה?")) return;
    setBusy(true);
    try {
      await base44.entities.Lead.delete(id);
      setLeads((ls) => (ls || []).filter((l) => l.id !== id));
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const counts = (leads || []).reduce((acc, l) => {
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
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex flex-wrap items-center gap-2">
            {["all", ...STATUS].map((s) => {
              const active = filter === s;
              const label = s === "all" ? "הכל" : STATUS_LABEL[s];
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
          <button
            onClick={exportCsv}
            disabled={!filtered.length}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-accent-foreground font-medium hover:bg-accent/90 disabled:opacity-40 transition-colors"
          >
            <Download size={16} /> ייצוא ל-CSV
          </button>
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
                        {STATUS_LABEL[l.status] || l.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={l.status}
                          onChange={(e) => updateStatus(l.id, e.target.value)}
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