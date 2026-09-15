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
  ]
});
