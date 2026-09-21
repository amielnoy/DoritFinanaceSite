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
  /** Which store is authoritative — see `src/config/data-primary.ts`. */
  readonly VITE_DATA_PRIMARY?: "base44" | "supabase";
  /** Who answers "who is signed in" — see `src/config/auth-provider.ts`. */
  readonly VITE_AUTH_PROVIDER?: "base44" | "supabase";
  readonly VITE_BASE44_APP_ID?: string;
  readonly VITE_BASE44_FUNCTIONS_VERSION?: string;
  readonly VITE_BASE44_APP_BASE_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
