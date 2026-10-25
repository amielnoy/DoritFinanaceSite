import {
  OnboardingConflictError,
  type OnboardingAgencySummary,
  type OnboardingOutcome,
  type OnboardingPort,
  type OnboardingRecord,
  type OnboardingRow,
  type PortraitFiles,
} from "../ports";

type DbError = { message: string; code?: string; details?: string | null } | null;
type Answer = { data: unknown; error: DbError };

interface Query extends PromiseLike<Answer> {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: readonly unknown[]): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
}

/** The part of supabase-js the wizard uses, under the signed-in person's session. */
export interface OnboardingClient {
  from(table: string): {
    select(columns: string): Query;
    update(values: OnboardingRow): Query;
    insert(values: OnboardingRow): Query;
    delete(): Query;
  };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<Answer>;
  storage: {
    from(bucket: string): {
      upload(path: string, file: Blob, options: { contentType: string; upsert: boolean }): PromiseLike<{ error: DbError }>;
      remove(paths: string[]): PromiseLike<{ error: DbError }>;
    };
  };
}

export const AGENT_PHOTOS_BUCKET = "agent-photos";

const PROFILE_COLUMNS =
  "agency_id,display_name,phone_e164,phone_display,whatsapp,email,default_whatsapp_message,licence_entity,service_area,notify_emails,onboarding,updated_at,domain,mail_from,ga4_measurement_id,disclosures_approved_at,consent_version";
const AGENT_COLUMNS =
  "id,agency_id,full_name,grammatical_gender,professional_title,photo_path,photo_alt,licence_number,licence_types,licence_regulator,has_institutional_affiliation,affiliations,bio,stats,booking_url,meeting_minutes,review_links,licence_verified_at,verified_licence_number,updated_at";
const TESTIMONIAL_COLUMNS = "id,agency_id,agent_id,name,role,quote,rating,source,source_url,consent_confirmed_at,sort_order";
const CASE_COLUMNS = "id,agency_id,agent_id,title,body,metric,sort_order,published";

const rows = (a: Answer): OnboardingRow[] => (Array.isArray(a.data) ? (a.data as OnboardingRow[]) : []);

function check(a: Answer, what: string): OnboardingRow[] {
  if (a.error) throw new Error(`${what}: ${a.error.message}`);
  return rows(a);
}

/** The Hebrew a refusal shows; the RPCs' named keys travel separately. */
const REFUSAL: Record<string, string> = {
  forbidden: "אין לך הרשאה לפעולה הזו.",
  not_signed_in: "נדרשת התחברות.",
  field_required: "חסר שדה חובה.",
  field_too_long: "אחד השדות ארוך מדי.",
  invalid_email: "כתובת הדוא״ל אינה תקינה.",
  not_found: "הסוכנות לא נמצאה.",
  wrong_status: "הסוכנות כבר אינה בשלב הזה. רעננו את הדף.",
  incomplete: "חסרים פרטים לפני שליחה לאישור.",
  gates_closed: "אחד מתנאי ההפעלה עדיין לא התקיים.",
  operator_only: "השדה הזה נערך רק על ידי מפעיל הפלטפורמה.",
};

function outcome(error: DbError): OnboardingOutcome {
  if (!error) return { ok: true };
  const keys = (error.details ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  return {
    ok: false,
    missing: error.message === "incomplete" ? keys : [],
    gates: error.message === "gates_closed" ? keys : [],
    message: REFUSAL[error.message] ?? `הפעולה נכשלה: ${error.message}`,
  };
}

/** `<agency>/<agent>/portrait-<stamp>-768.webp` → the stem the three widths share (src/lib/portrait.ts). */
const stemOf = (path: string) => (path.endsWith("-768.webp") ? path.slice(0, -"-768.webp".length) : null);
const setOf = (stem: string) => [480, 768, 1080].map((w) => `${stem}-${w}.webp`);

/**
 * The new-agency wizard over Supabase. Every read and write runs under the
 * person's own session: onboarding_role decides the owner's, is_admin the
 * operator's, and the guard triggers keep the operator's columns theirs
 * (20261106000000_agency_onboarding.sql). Nothing here grants anything.
 */
export class SupabaseOnboardingService implements OnboardingPort {
  constructor(private readonly client: OnboardingClient) {}

  async createAgency(input: { name: string; ownerEmail: string; dpaDate: string | null }): Promise<string> {
    const a = await this.client.rpc("create_agency", { p_name: input.name, p_owner_email: input.ownerEmail, p_dpa_date: input.dpaDate });
    if (a.error) throw new Error(REFUSAL[a.error.message] ?? `פתיחת הסוכנות נכשלה: ${a.error.message}`);
    return String(a.data);
  }

  async role(agencyId: string): Promise<"owner" | "admin" | "user" | null> {
    const a = await this.client.rpc("onboarding_role", { p_agency_id: agencyId });
    if (a.error) throw new Error("לא הצלחנו לאמת את ההרשאה");
    return a.data === "owner" || a.data === "admin" || a.data === "user" ? a.data : null;
  }

  async load(agencyId: string): Promise<OnboardingRecord> {
    const [agency, profile, agents, testimonials, cases] = await Promise.all([
      this.client.from("agencies").select("id,name,status,data_processing_agreement_date").eq("id", agencyId),
      this.client.from("agency_profiles").select(PROFILE_COLUMNS).eq("agency_id", agencyId),
      this.client.from("agents").select(AGENT_COLUMNS).eq("agency_id", agencyId).order("created_at", { ascending: true }).limit(1),
      this.client.from("testimonials").select(TESTIMONIAL_COLUMNS).eq("agency_id", agencyId).order("sort_order", { ascending: true }),
      this.client.from("success_cases").select(CASE_COLUMNS).eq("agency_id", agencyId).order("sort_order", { ascending: true }),
    ]);
    const agencyRow = check(agency, "agencies")[0];
    const profileRow = check(profile, "agency_profiles")[0];
    if (!agencyRow || !profileRow) throw new Error("הסוכנות לא נמצאה, או שאין לך גישה אליה.");
    return {
      agencies: agencyRow,
      agency_profiles: profileRow,
      agents: check(agents, "agents")[0] ?? null,
      testimonials: check(testimonials, "testimonials"),
      success_cases: check(cases, "success_cases"),
    };
  }

  /** An update filtered on the updated_at the step opened with; no row back means someone saved in between, or no right to. */
  private async guarded(table: string, key: string, id: string, patch: OnboardingRow, expected: string | null, columns: string) {
    let q = this.client.from(table).update(patch).eq(key, id);
    if (expected) q = q.eq("updated_at", expected);
    const saved = check(await q.select(columns), table)[0];
    if (saved) return saved;
    const now = check(await this.client.from(table).select("updated_at").eq(key, id), table)[0];
    if (now && expected && now.updated_at !== expected) throw new OnboardingConflictError();
    throw new Error("השמירה לא בוצעה — אין לך הרשאה לערוך את הסוכנות הזו.");
  }

  saveProfile(agencyId: string, patch: OnboardingRow, expectedUpdatedAt: string | null): Promise<OnboardingRow> {
    return this.guarded("agency_profiles", "agency_id", agencyId, patch, expectedUpdatedAt, PROFILE_COLUMNS);
  }

  async saveAgent(agencyId: string, agentId: string | null, patch: OnboardingRow, expectedUpdatedAt: string | null): Promise<OnboardingRow> {
    if (agentId) return this.guarded("agents", "id", agentId, patch, expectedUpdatedAt, AGENT_COLUMNS);
    const created = check(await this.client.from("agents").insert({ ...patch, agency_id: agencyId }).select(AGENT_COLUMNS), "agents")[0];
    if (!created) throw new Error("השמירה לא בוצעה — אין לך הרשאה לערוך את הסוכנות הזו.");
    return created;
  }

  async saveTestimonial(agencyId: string, row: OnboardingRow): Promise<OnboardingRow> {
    const { id, ...values } = row;
    // Every read of testimonials names its columns: consent_confirmed_by stays out (SEC-AGC-002).
    const q = id
      ? this.client.from("testimonials").update(values).eq("id", id).select(TESTIMONIAL_COLUMNS)
      : this.client.from("testimonials").insert({ ...values, agency_id: agencyId }).select(TESTIMONIAL_COLUMNS);
    const saved = check(await q, "testimonials")[0];
    if (!saved) throw new Error("ההמלצה לא נשמרה.");
    return saved;
  }

  async deleteTestimonial(id: string): Promise<void> {
    check(await this.client.from("testimonials").delete().eq("id", id).select("id"), "testimonials");
  }

  async saveSuccessCase(agencyId: string, row: OnboardingRow): Promise<OnboardingRow> {
    const { id, ...values } = row;
    const q = id
      ? this.client.from("success_cases").update(values).eq("id", id)
      : this.client.from("success_cases").insert({ ...values, agency_id: agencyId });
    const saved = check(await q.select(CASE_COLUMNS), "success_cases")[0];
    if (!saved) throw new Error("תיק ההצלחה לא נשמר.");
    return saved;
  }

  async deleteSuccessCase(id: string): Promise<void> {
    check(await this.client.from("success_cases").delete().eq("id", id).select("id"), "success_cases");
  }

  async uploadPortrait(agencyId: string, agentId: string, files: PortraitFiles, previousPath: string | null): Promise<{ photoPath: string; updatedAt: string | null }> {
    const bucket = this.client.storage.from(AGENT_PHOTOS_BUCKET);
    const stem = `${agencyId}/${agentId}/portrait-${Date.now().toString(36)}`;
    const uploaded: string[] = [];
    for (const width of [480, 768, 1080] as const) {
      const path = `${stem}-${width}.webp`;
      const { error } = await bucket.upload(path, files[width], { contentType: "image/webp", upsert: false });
      if (error) {
        // Nothing points at a half-uploaded set; what did arrive goes again.
        if (uploaded.length) await bucket.remove(uploaded);
        throw new Error("העלאת התמונה נכשלה. אפשר לנסות שוב.");
      }
      uploaded.push(path);
    }
    const photoPath = `${stem}-768.webp`;
    const row = check(await this.client.from("agents").update({ photo_path: photoPath }).eq("id", agentId).select("id,updated_at"), "agents")[0];
    const old = previousPath ? stemOf(previousPath) : null;
    if (old) await bucket.remove(setOf(old));
    return { photoPath, updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null };
  }

  async removePortrait(_agencyId: string, agentId: string, path: string): Promise<{ updatedAt: string | null }> {
    const row = check(await this.client.from("agents").update({ photo_path: null }).eq("id", agentId).select("id,updated_at"), "agents")[0];
    const stem = stemOf(path);
    if (stem) await this.client.storage.from(AGENT_PHOTOS_BUCKET).remove(setOf(stem));
    return { updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null };
  }

  async submit(agencyId: string): Promise<OnboardingOutcome> {
    return outcome((await this.client.rpc("submit_agency_for_review", { p_agency_id: agencyId })).error);
  }

  async listInProgress(): Promise<OnboardingAgencySummary[]> {
    const agencies = check(
      await this.client.from("agencies").select("id,name,status").in("status", ["draft", "pending_review"]),
      "agencies",
    );
    if (!agencies.length) return [];
    const profiles = check(
      await this.client.from("agency_profiles").select("agency_id,updated_at,onboarding").in("agency_id", agencies.map((a) => a.id)),
      "agency_profiles",
    );
    const byId = new Map(profiles.map((p) => [String(p.agency_id), p]));
    return agencies
      .map((a) => {
        const p = byId.get(String(a.id));
        const review = ((p?.onboarding as OnboardingRow | undefined)?.review ?? {}) as OnboardingRow;
        return {
          id: String(a.id),
          name: String(a.name ?? ""),
          status: a.status as OnboardingAgencySummary["status"],
          lastEdited: typeof p?.updated_at === "string" ? p.updated_at : null,
          ownerEmail: typeof review.owner_email === "string" ? review.owner_email : null,
        };
      })
      .sort((x, y) => (y.lastEdited ?? "").localeCompare(x.lastEdited ?? ""));
  }

  async returnAgency(agencyId: string, note: string): Promise<OnboardingOutcome> {
    return outcome((await this.client.rpc("return_agency", { p_agency_id: agencyId, p_note: note })).error);
  }

  async activate(agencyId: string): Promise<OnboardingOutcome> {
    return outcome((await this.client.rpc("activate_agency", { p_agency_id: agencyId })).error);
  }

  async setDpaDate(agencyId: string, date: string | null): Promise<void> {
    const done = check(
      await this.client.from("agencies").update({ data_processing_agreement_date: date }).eq("id", agencyId).select("id"),
      "agencies",
    );
    if (!done.length) throw new Error(REFUSAL.forbidden);
  }

  async setLicenceVerified(agentId: string, verified: boolean): Promise<void> {
    const done = check(
      await this.client.from("agents").update({ licence_verified_at: verified ? new Date().toISOString() : null }).eq("id", agentId).select("id"),
      "agents",
    );
    if (!done.length) throw new Error(REFUSAL.forbidden);
  }

  async setDisclosuresApproved(agencyId: string, approved: boolean): Promise<void> {
    const done = check(
      await this.client
        .from("agency_profiles")
        .update({ disclosures_approved_at: approved ? new Date().toISOString() : null })
        .eq("agency_id", agencyId)
        .select("agency_id"),
      "agency_profiles",
    );
    if (!done.length) throw new Error(REFUSAL.forbidden);
  }

  async setOperatorFields(
    agencyId: string,
    fields: { domain?: string | null; mail_from?: string | null; ga4_measurement_id?: string | null },
  ): Promise<void> {
    const a = await this.client.from("agency_profiles").update(fields).eq("agency_id", agencyId).select("agency_id");
    if (a.error) throw new Error(REFUSAL[a.error.message] ?? `השמירה נכשלה: ${a.error.message}`);
    if (!rows(a).length) throw new Error(REFUSAL.forbidden);
  }
}
