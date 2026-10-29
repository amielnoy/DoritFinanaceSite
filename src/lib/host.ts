/** A hostname as `location.hostname` gives it: lower case, no trailing dot. */
export function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase();
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return "";
    }
  }
  return host.replace(/\.+$/, "");
}
