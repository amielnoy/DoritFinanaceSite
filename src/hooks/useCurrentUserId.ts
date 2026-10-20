import { useAuth } from "@/lib/AuthContext";

/** The signed-in person's id, or null. */
export function useCurrentUserId(): string | null {
  return useAuth().user?.id ?? null;
}
