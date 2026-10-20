import { useAuth } from "@/lib/AuthContext";

/** The signed-in person's id, or null — also outside an AuthProvider, where `useAuth` throws (after its single useContext, so hook order holds). */
export function useCurrentUserId(): string | null {
  try {
    const id = useAuth().user?.id;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}
