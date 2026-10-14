import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import { clearAccessTokenIfRequested } from '@/lib/clear-access-token'
import { watchFreshness } from '@/lib/freshness'
import { installTrustedTypes } from '@/lib/trusted-types'
import '@/fonts.css'
import '@/index.css'

// First, the Trusted Types policies: Vercel Analytics and the freshness check
// below both reach an injection sink, and vercel.json reports any sink that is
// handed a plain string. See trusted-types.ts.
installTrustedTypes()

// ?clear_access_token=true wipes the stored tokens on every route, before the
// router reads the URL and before any SDK could read a token. It used to wait
// for the lazily loaded services, which some visits never load — see the file.
clearAccessTokenIfRequested()

// Before anything renders: is this the build the server is still serving? A
// phone can hold last week's `index.html` for a week, and nothing about it
// looks wrong — see A-57 and the note in freshness.ts.
watchFreshness()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
