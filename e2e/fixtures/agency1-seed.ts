import { readFileSync } from "node:fs";
import { AGENCY_PROFILE } from "../../src/config/agencyProfile.ts";

/**
 * Agency 1's content as the seed migration writes it, for the e2e Supabase
 * fake (Task 7) and the contract test. Node and Vitest both load this file:
 * erasable TypeScript only, relative imports with their extension, no aliases.
 *
 * The migration holds the values as one JSON document between two $json$
 * markers, so there is a single copy of them to keep and nothing here is typed
 * out a second time.
 */

export const SEED_FILE = new URL("../../supabase/migrations/20261107000000_seed_agency1_content.sql", import.meta.url)
  .pathname;

export type Row = Record<string, unknown>;

export interface Agency1Seed {
  agency_id: string;
  agent: {
    id: string;
    full_name: string;
    grammatical_gender: string;
    professional_title: string;
    photo_alt: string;
    licence_number: string;
    licence_regulator: string;
    has_institutional_affiliation: boolean;
    bio: {
      headline: string;
      family: string;
      credentials: string;
      career: string;
      insight: string;
      unique: string;
      signature: string;
    };
    stats: { num: string; label: string }[];
    review_links: { google: string; midrag: string };
    meeting_minutes: number;
  };
  success_cases: {
    id: string;
    sort_order: number;
    tag: string;
    title: string;
    body: string;
    metric: string;
    metric_is_estimate: boolean;
  }[];
  profile: { notify_emails: string[]; domain: string; consent_version: string };
}

/** The document between the two `$json$` markers. */
export function readAgency1Seed(sql: string = readFileSync(SEED_FILE, "utf8")): Agency1Seed {
  const parts = sql.split("$json$");
  if (parts.length !== 3) throw new Error(`expected two $json$ markers, found ${parts.length - 1}`);
  return JSON.parse(parts[1]) as Agency1Seed;
}

/**
 * The seeded tables as PostgREST returns them, keyed by table or view name.
 * The columns are the views' (public_agency_sites, public_agent_cards) and the
 * table's (success_cases). The card shows the verified licence number, which
 * for agency 1 is the seed's.
 */
export function agency1ContentRows(): Map<string, Row[]> {
  const seed = readAgency1Seed();
  const { agent } = seed;
  const stamp = "2026-10-21T00:00:00.000Z";
  return new Map<string, Row[]>([
    [
      "public_agency_sites",
      [
        {
          agency_id: seed.agency_id,
          domain: seed.profile.domain,
          display_name: AGENCY_PROFILE.displayName,
          phone_e164: AGENCY_PROFILE.phoneE164,
          phone_display: AGENCY_PROFILE.phoneDisplay,
          whatsapp: AGENCY_PROFILE.whatsapp,
          email: AGENCY_PROFILE.email,
          default_whatsapp_message: AGENCY_PROFILE.defaultWhatsappMessage,
          service_area: null,
        },
      ],
    ],
    [
      "public_agent_cards",
      [
        {
          id: agent.id,
          agency_id: seed.agency_id,
          full_name: agent.full_name,
          grammatical_gender: agent.grammatical_gender,
          professional_title: agent.professional_title,
          photo_path: null,
          photo_alt: agent.photo_alt,
          licence_number: agent.licence_number,
          licence_types: [],
          licence_regulator: agent.licence_regulator,
          has_institutional_affiliation: agent.has_institutional_affiliation,
          affiliations: [],
          bio: agent.bio,
          stats: agent.stats,
          booking_url: null,
          meeting_minutes: agent.meeting_minutes,
          review_links: agent.review_links,
        },
      ],
    ],
    [
      "success_cases",
      seed.success_cases.map((c) => ({
        ...c,
        agency_id: seed.agency_id,
        agent_id: agent.id,
        published: true,
        created_at: stamp,
        updated_at: stamp,
      })),
    ],
  ]);
}
