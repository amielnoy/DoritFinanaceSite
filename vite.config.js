import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { siteUrl } from './scripts/vite-site-url-plugin.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
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
   * simply changed. A contract test fails on the duplicate so it gets cleaned
   * up, but the swap is silent until CI runs. Putting `.ts`/`.tsx` first makes
   * the collision harmless rather than merely detectable — this repo is
   * TypeScript, and the TypeScript file is always the one that means something.
   */
  resolve: {
    extensions: ['.mjs', '.mts', '.ts', '.tsx', '.js', '.jsx', '.json'],
    // `@/x` is `src/x`. vitest.config.ts spells the same alias.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  /**
   * Stable vendor code gets its own chunks, so a deploy that only touches site
   * code does not invalidate them in the browser cache, and no single chunk
   * crosses the 500 kB warning line as the app grows. Vite 8 bundles with
   * rolldown, which replaced `manualChunks` with `codeSplitting.groups`.
   */
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // `tslib`'s helpers are shared by supabase-js and Radix
            // (react-remove-scroll). Left to the groups below they land in
            // vendor-supabase, and every page with a Radix component then
            // modulepreloads the whole SDK for four small functions.
            { name: 'vendor-tslib', test: /node_modules[\\/]tslib[\\/]/, priority: 60 },
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|@remix-run)[\\/]/, priority: 50 },
            { name: 'vendor-motion', test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/, priority: 40 },
            { name: 'vendor-supabase', test: /node_modules[\\/]@supabase[\\/]/, priority: 30 },
            { name: 'vendor-radix', test: /node_modules[\\/]@radix-ui[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
  define: {
    /**
     * Whether this build runs on a host that answers `/_vercel/insights/*`.
     *
     * Derived from `VERCEL`, which Vercel sets in every build on its own
     * infrastructure, rather than from a variable someone has to remember to
     * set: the failure mode of a hand-set flag is that a build off Vercel ships
     * with it on. A clone, `vite dev` and `vite preview` all read `false`
     * without configuring anything.
     *
     * Inlined as a literal `true`/`false`, so on every non-Vercel build the
     * `<Analytics />` branch in `App.jsx` is dead code and `@vercel/analytics`
     * drops out of the bundle entirely.
     */
    'import.meta.env.VITE_VERCEL_ANALYTICS': JSON.stringify(process.env.VERCEL === '1'),
  },
});
