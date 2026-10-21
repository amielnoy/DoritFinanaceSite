import { AGENCY1_ID } from "@/config/agency1";
import type {
  AgencyContentPort,
  AgencySiteRecord,
  AgentCardRecord,
  BioKey,
  SuccessCase,
} from "../ports";
import { CARD_COLUMNS, SITE_COLUMNS, SUCCESS_CASE_COLUMNS } from "./agency-content-tables";
import { fetchRows, type SupabaseTableClient } from "./SupabaseTableClient";

/**
 * Why a site's content could not be read. The hook shows the bundled agency-1
 * constants for every one of them; the code says which, for the console and
 * the tests.
 */
export class AgencyContentError extends Error {
  constructor(readonly code: "no_site" | "no_agent" | "incomplete") {
    super(`agency content: ${code}`);
    this.name = "AgencyContentError";
  }
}

/**
 * A host that may go into the PostgREST `or=(…)` filter. A comma or a bracket
 * would change the filter itself (`x),agency_id.eq.<another agency>`), so
 * anything else is never sent and the read asks for agency 1 alone.
 */
export const HOST_PATTERN = /^[a-z0-9.-]{1,253}$/;

const BIO_KEYS: readonly BioKey[] = ["headline", "family", "credentials", "career", "insight", "unique", "signature"];

type Row = Record<string, unknown>;

const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const https = (v: unknown): string | null => (typeof v === "string" && v.startsWith("https://") ? v : null);
const object = (v: unknown): Row | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null);

function required(v: unknown): string {
  const s = text(v);
  if (s === null) throw new AgencyContentError("incomplete");
  return s;
}

function toStats(v: unknown): AgentCardRecord["stats"] {
  if (!Array.isArray(v)) throw new AgencyContentError("incomplete");
  return v.map((item) => {
    const o = object(item);
    if (!o || typeof o.num !== "string" || typeof o.label !== "string") throw new AgencyContentError("incomplete");
    return { num: o.num, label: o.label };
  });
}

function toBio(v: unknown): AgentCardRecord["bio"] {
  const o = object(v);
  if (!o || text(o.headline) === null) throw new AgencyContentError("incomplete");
  const bio: AgentCardRecord["bio"] = {};
  for (const key of BIO_KEYS) {
    const value = text(o[key]);
    if (value !== null) bio[key] = value;
  }
  return bio;
}

/**
 * The database's checks already hold review links and the booking link to
 * https; this holds the page to them too, so a row that slipped past them can
 * never put a `javascript:` link on the site.
 */
function toReviewLinks(v: unknown): AgentCardRecord["reviewLinks"] {
  const o = object(v) ?? {};
  const links: AgentCardRecord["reviewLinks"] = {};
  const google = https(o.google);
  const midrag = https(o.midrag);
  if (google) links.google = google;
  if (midrag) links.midrag = midrag;
  return links;
}

/** A site row and its agent's card, checked; throws `incomplete` rather than inventing a field. */
export function toSiteRecord(site: Row, card: Row): AgencySiteRecord {
  const phoneE164 = required(site.phone_e164);
  return {
    agencyId: required(site.agency_id),
    contact: {
      phoneE164,
      phoneDisplay: text(site.phone_display) ?? phoneE164,
      whatsapp: required(site.whatsapp),
      email: required(site.email),
      defaultWhatsappMessage: text(site.default_whatsapp_message) ?? "",
    },
    agent: {
      fullName: required(card.full_name),
      professionalTitle: text(card.professional_title),
      photoPath: text(card.photo_path),
      photoAlt: text(card.photo_alt),
      licenceNumber: required(card.licence_number),
      bio: toBio(card.bio),
      stats: toStats(card.stats),
      bookingUrl: https(card.booking_url),
      reviewLinks: toReviewLinks(card.review_links),
    },
  };
}

export function toSuccessCase(row: Row): SuccessCase {
  return {
    tag: text(row.tag),
    title: required(row.title),
    body: required(row.body),
    metric: text(row.metric),
    estimate: row.metric_is_estimate === true,
  };
}

/**
 * Read side of an agency's public content, on Supabase, through the definer
 * views anon may read (`public_agency_sites`, `public_agent_cards`) and the
 * `success_cases` table.
 */
export class SupabaseAgencyContentService implements AgencyContentPort {
  constructor(private readonly client: SupabaseTableClient) {}

  /**
   * One request asks for the agency claiming the host and for agency 1, and
   * the claim wins. Agency 1 answers for every host nobody claims: localhost,
   * a Vercel preview, an unknown or a hostile one (R8).
   */
  async siteContent(host: string): Promise<AgencySiteRecord> {
    const claimable = HOST_PATTERN.test(host);
    const clauses = claimable ? [`domain.eq.${host}`, `agency_id.eq.${AGENCY1_ID}`] : [`agency_id.eq.${AGENCY1_ID}`];
    const sites = await fetchRows(
      this.client.from("public_agency_sites").select(SITE_COLUMNS).or(clauses.join(",")).limit(2),
      "public_agency_sites",
    );
    const site =
      (claimable ? sites.find((r) => r.domain === host) : undefined) ?? sites.find((r) => r.agency_id === AGENCY1_ID);
    if (!site) throw new AgencyContentError("no_site");

    const cards = await fetchRows(
      this.client
        .from("public_agent_cards")
        .select(CARD_COLUMNS)
        .eq("agency_id", site.agency_id)
        .order("id", { ascending: true })
        .limit(1),
      "public_agent_cards",
    );
    if (!cards[0]) throw new AgencyContentError("no_agent");
    return toSiteRecord(site, cards[0]);
  }

  /**
   * The `published` filter stays in the query although RLS already hides
   * drafts from an anonymous reader: a signed-in owner passes the onboarding
   * policy, and her public page must not show her drafts either.
   */
  async successCases(agencyId: string): Promise<SuccessCase[]> {
    const rows = await fetchRows(
      this.client
        .from("success_cases")
        .select(SUCCESS_CASE_COLUMNS)
        .eq("agency_id", agencyId)
        .eq("published", true)
        .order("sort_order", { ascending: true })
        .limit(20),
      "success_cases",
    );
    return rows.map(toSuccessCase);
  }
}
