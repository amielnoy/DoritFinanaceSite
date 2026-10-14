/**
 * The build-time environment, typed.
 *
 * Vite inlines these at build time, so a value handed to the preview server
 * arrives after the only moment it could have been read. `app-params.js` has
 * read them all along without this file because `checkJs` is off; the moment a
 * `.ts` file reads one, `import.meta.env` needs a declaration — and `types: []`
 * in tsconfig means it has to be spelled out here rather than pulled from
 * `vite/client`.
 *
 * Every name is optional: a missing variable is a real state at runtime, and
 * pretending otherwise just moves the failure somewhere less obvious.
 */
interface ImportMetaEnv {
  /** Who stores a claim document — see `src/config/upload-provider.ts`. */
  readonly VITE_UPLOAD_PROVIDER?: "base44" | "supabase";
  /** Who stores article and testimonial images — see `src/config/upload-provider.ts`. */
  readonly VITE_CONTENT_IMAGES?: "base44" | "supabase";
  readonly VITE_LEAD_FUNCTIONS?: "base44" | "supabase";
  /** The clearinghouse pipeline — on only when exactly "true"; see `src/config/masleka.ts`. */
  readonly VITE_MASLEKA_ENABLED?: string;
  /** Who writes articles and testimonials — see `src/config/content-writes.ts`. */
  readonly VITE_CONTENT_WRITES?: "base44" | "supabase";
  /** Agents served by the `chat` Edge Function — see `src/config/chat-agents.ts`. */
  readonly VITE_CHAT_AGENTS?: string;
  readonly VITE_BASE44_APP_ID?: string;
  readonly VITE_BASE44_FUNCTIONS_VERSION?: string;
  readonly VITE_BASE44_APP_BASE_URL?: string;
  /** Hosts the page leaves for the canonical one, comma-separated; `none` turns it off — see `src/lib/legacy-host.ts`. */
  readonly VITE_LEGACY_HOSTS?: string;
  readonly VITE_SUPABASE_URL?: string;
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
