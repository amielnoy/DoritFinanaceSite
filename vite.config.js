import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { base44Backend } from './scripts/vite-base44-backend-plugin.mjs'
import { siteUrl } from './scripts/vite-site-url-plugin.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      hmrNotifier: true,
      navigationNotifier: true,
      analyticsTracker: true,
      visualEditAgent: true
    }),
    react(),
    // Gives a build run from a clone the app id Base44's own hosting injects,
    // and lets `vite preview` reach a backend the way the deployed site does.
    // Both inert until this clone is linked / VITE_BASE44_APP_BASE_URL is set.
    base44Backend(),
    // Rewrites the canonical host in sitemap.xml, robots.txt and llms.txt when
    // VITE_SITE_URL names a different origin. See the plugin for why.
    siteUrl(),
  ],
  /**
   * TypeScript wins a name collision, which Vite's default order does not do.
   *
   * The default is ['.mjs','.js','.mts','.ts','.jsx','.tsx','.json'] — `.jsx`
   * ahead of `.tsx`. So the day something dropped `src/pages/Login.jsx` beside
   * the real `src/pages/Login.tsx`, the boilerplate became the login page and
   * the TypeScript one stopped being imported by anything while still sitting
   * there looking authoritative (A-46). Nothing failed; the file that shipped
   * simply changed.
   *
   * That keeps happening: the Base44 Builder re-adds those templates on its own
   * schedule, three times in one day (A-50). A contract test fails on the
   * duplicate so it gets cleaned up, but the test runs in CI and the swap is
   * silent in between. Putting `.ts`/`.tsx` first makes the collision harmless
   * rather than merely detectable — this repo is TypeScript, and the TypeScript
   * file is always the one that means something.
   */
  resolve: {
    extensions: ['.mjs', '.mts', '.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  define: {
    /**
     * Whether this build runs on a host that answers `/_vercel/insights/*`.
     *
     * Derived from `VERCEL`, which Vercel sets in every build on its own
     * infrastructure, rather than from a variable someone has to remember to
     * set: the failure mode of a hand-set flag is that a Base44 build ships
     * with it on, which is the exact state this replaces. A clone, `base44
     * dev`, `vite preview` and the Base44 production build all read `false`
     * without configuring anything.
     *
     * Inlined as a literal `true`/`false`, so on every non-Vercel build the
     * `<Analytics />` branch in `App.jsx` is dead code and `@vercel/analytics`
     * drops out of the bundle entirely.
     */
    'import.meta.env.VITE_VERCEL_ANALYTICS': JSON.stringify(process.env.VERCEL === '1'),
  },
});
