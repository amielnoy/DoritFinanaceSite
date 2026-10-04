import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import { watchFreshness } from '@/lib/freshness'
import '@/index.css'

// Before anything renders: is this the build the server is still serving? A
// phone can hold last week's `index.html` for a week, and nothing about it
// looks wrong — see A-57 and the note in freshness.ts.
watchFreshness()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
