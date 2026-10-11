import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  // Where the SDK sends API calls *and* opens the socket that carries agent
  // replies — it has one setting for both.
  //
  // Empty means "this origin". That is right when Base44 hosts the site, and in
  // e2e, where the fixtures stub same-origin /api and a request that slips past
  // them must 404 rather than reach the real backend. On Vercel it is wrong for
  // the socket: vercel.json's rewrite to Base44 carries HTTP but not a
  // WebSocket upgrade, so after the domain moved to Vercel every chat sent its
  // message and never received the reply (2026-10-11). Production and preview
  // set VITE_BASE44_SERVER_URL to the app's own Base44 host, which allows this
  // origin for both CORS and the socket.
  serverUrl: import.meta.env.VITE_BASE44_SERVER_URL || '',
  appBaseUrl
});
