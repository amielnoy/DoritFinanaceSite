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
