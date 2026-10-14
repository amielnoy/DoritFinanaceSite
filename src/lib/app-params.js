import { getAccessToken } from '@base44/sdk';
import { clearAccessTokenIfRequested } from '@/lib/clear-access-token';

const getAppParams = () => {
	// main.jsx has already done this at boot and removed the flag, so this is a
	// no-op there; it stays for any entry that reaches the SDK without main.jsx.
	clearAccessTokenIfRequested();
	return {
		appId: import.meta.env.VITE_BASE44_APP_ID,
		token: getAccessToken(),
		functionsVersion: import.meta.env.VITE_BASE44_FUNCTIONS_VERSION,
		appBaseUrl: import.meta.env.VITE_BASE44_APP_BASE_URL,
	}
}


export const appParams = {
	...getAppParams()
}
