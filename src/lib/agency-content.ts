import { AGENCY1_CASES, AGENCY1_ID, AGENCY1_REVIEW_LINKS } from "@/config/agency1";
import { AGENCY_PROFILE } from "@/config/agencyProfile";
import { CONTACT } from "@/config/contact";
import { CAL_LINK } from "@/config/offers";
import { normalizeHost } from "@/lib/legacy-host";
import { portraitFor, type Portrait } from "@/lib/portrait";
import type { AgencyContact, AgencySiteRecord, SuccessCase } from "@/services/ports";

/** `useT("home")`, widened: the bundled content reads only keys home.json has. */
export type Translate = (key: string) => string;

export interface AgentBio {
  headline: string;
  family: string | null;
  credentials: string | null;
  career: string | null;
  insight: string | null;
  unique: string | null;
  signature: string | null;
}

/**
 * Everything the public pages show of the agency a host belongs to: from the
 * database (`source: "database"`) or the bundled agency-1 constants, which are
 * what the site has always shown and what it falls back to (R1).
 */
export interface AgencyContent {
  agencyId: string;
  source: "bundled" | "database";
  contact: AgencyContact;
  agent: {
    fullName: string;
    /** "name · title", as the hero prints it; the name alone without a title. */
    byline: string;
    licenceNumber: string;
    portrait: Portrait;
    bio: AgentBio;
    stats: readonly { num: string; label: string }[];
    bookingUrl: string | null;
    reviewLinks: { google: string | null; midrag: string | null };
  };
}

/** The host an agency claims: `location.hostname` normalized, one leading `www.` dropped (R8). */
export function siteHost(hostname: string): string {
  return normalizeHost(hostname).replace(/^www\./, "");
}

/** Agency 1 as the site shows it without the database, in the page's language. */
export function bundledAgencyContent(t: Translate): AgencyContent {
  return {
    agencyId: AGENCY1_ID,
    source: "bundled",
    contact: { ...CONTACT },
    agent: {
      fullName: AGENCY_PROFILE.displayName,
      byline: t("hero.byline"),
      licenceNumber: AGENCY_PROFILE.licenceNumber,
      portrait: { kind: "bundled", alt: t("hero.portraitAlt") },
      bio: {
        headline: t("hero.lead"),
        family: t("about.family"),
        credentials: t("about.credentials"),
        career: t("about.career"),
        insight: t("about.insight"),
        unique: t("about.unique"),
        signature: t("about.signature"),
      },
      stats: [1, 2, 3].map((n) => ({ num: t(`about.stat${n}Num`), label: t(`about.stat${n}`) })),
      bookingUrl: CAL_LINK,
      reviewLinks: { google: AGENCY1_REVIEW_LINKS.google, midrag: AGENCY1_REVIEW_LINKS.midrag },
    },
  };
}

/** Agency 1's proof cases (`proof.cN.*` in home.json). */
export function bundledSuccessCases(t: Translate): SuccessCase[] {
  return AGENCY1_CASES.map(({ key, estimate }) => ({
    tag: t(`proof.${key}.tag`),
    title: t(`proof.${key}.title`),
    body: t(`proof.${key}.body`),
    metric: t(`proof.${key}.metric`),
    estimate,
  }));
}

/**
 * A database record as the pages show it. Every optional field comes out
 * null, never undefined, so a component tests one value for "absent".
 *
 * `bundled` lends only what the database cannot hold for agency 1: her Cal.com
 * link is a build-time setting (`VITE_CAL_LINK`), so her row has none. Another
 * agency without a link gets none — never Dorit's.
 */
export function resolveAgencyContent(
  record: AgencySiteRecord,
  bundled: AgencyContent,
  photoBase: string | null,
): AgencyContent {
  const { agencyId, agent } = record;
  return {
    agencyId,
    source: "database",
    contact: { ...record.contact },
    agent: {
      fullName: agent.fullName,
      byline: agent.professionalTitle ? `${agent.fullName} · ${agent.professionalTitle}` : agent.fullName,
      licenceNumber: agent.licenceNumber,
      portrait: portraitFor(
        { agencyId, photoPath: agent.photoPath, photoAlt: agent.photoAlt, fullName: agent.fullName },
        photoBase,
      ),
      bio: {
        headline: agent.bio.headline ?? "",
        family: agent.bio.family ?? null,
        credentials: agent.bio.credentials ?? null,
        career: agent.bio.career ?? null,
        insight: agent.bio.insight ?? null,
        unique: agent.bio.unique ?? null,
        signature: agent.bio.signature ?? null,
      },
      stats: agent.stats.map(({ num, label }) => ({ num, label })),
      bookingUrl: agent.bookingUrl ?? (agencyId === AGENCY1_ID ? bundled.agent.bookingUrl : null),
      reviewLinks: { google: agent.reviewLinks.google ?? null, midrag: agent.reviewLinks.midrag ?? null },
    },
  };
}
