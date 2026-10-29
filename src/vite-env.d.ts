/**
 * The build-time environment, typed.
 *
 * Vite inlines these at build time, so a value handed to the preview server
 * arrives after the only moment it could have been read. `checkJs` is off, so a `.js`
 * file can read one undeclared; the moment a `.ts` file does, `import.meta.env`
 * needs a declaration — and `types: []` in tsconfig means it has to be spelled
 * out here rather than pulled from `vite/client`.
 *
 * Every name is optional: a missing variable is a real state at runtime, and
 * pretending otherwise just moves the failure somewhere less obvious.
 */
interface ImportMetaEnv {
  /** The clearinghouse pipeline — on only when exactly "true"; see `src/config/masleka.ts`. */
  readonly VITE_MASLEKA_ENABLED?: string;
  readonly VITE_MEETINGS_STAFF?: string;
  /** The new-agency wizard (src/config/agency-onboarding.ts); off unless "true". */
  readonly VITE_AGENCY_ONBOARDING?: string;
  /** Hours an urgent lead may stay "חדשה" before the leads screen alerts (src/config/leads.ts); default 4. */
  readonly VITE_LEAD_SLA_URGENT_HOURS?: string;
  /** "תדריך לפני שיחה" in a lead's drawer (src/config/lead-briefing.ts); off unless "true". */
  readonly VITE_LEAD_BRIEFING?: string;
  readonly VITE_MEETINGS_CLIENT?: string;
  /** Staff-created leads — on only when exactly "true"; see `src/config/staff-leads.ts`. */
  readonly VITE_STAFF_LEADS?: string;
  /** Staff-added clients — on only when exactly "true" (and VITE_STAFF_LEADS); see `src/config/staff-clients.ts`. */
  readonly VITE_STAFF_CLIENTS?: string;
  /** "true" asks before Google Analytics loads (src/lib/consent.ts). Off: GA4 loads as it always has. */
  readonly VITE_GA_CONSENT?: string;
  /** Agency content from the database — on only when exactly "true"; see `src/config/agency-content.ts`. */
  readonly VITE_AGENCY_CONTENT?: string;
  readonly VITE_SNAPSHOT_HOME?: string;
  /** Hosts the page leaves for the canonical one, comma-separated; `none` turns it off — see `src/lib/legacy-host.ts`. */
  readonly VITE_LEGACY_HOSTS?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_LOCALES?: string;
  readonly VITE_CAL_LINK?: string;
  readonly VITE_WHATSAPP_CHANNEL_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /**
   * A boolean, not a string, and the one name here that never comes from a
   * `.env` file — `vite.config.js` inlines it from Vercel's own `VERCEL`.
   */
  readonly VITE_VERCEL_ANALYTICS?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
