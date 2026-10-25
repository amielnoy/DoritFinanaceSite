import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { useMyAgencies } from "@/hooks/useAgency";
import { AGENCY_ONBOARDING } from "@/config/agency-onboarding";

/** Where someone lands after signing in, when no page asked for them (`/`, or the client area's `/account`). */
const LANDINGS = new Set(["/", "/account"]);

/**
 * After sign-in, an owner whose only agency is still a draft lands in its
 * wizard (spec, Frontend). Once per visit, only from a landing page, never for
 * the platform operator, and not at all with VITE_AGENCY_ONBOARDING off.
 */
export default function DraftOwnerRedirect() {
  const { user, isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const mine = useMyAgencies();
  const done = useRef(false);

  useEffect(() => {
    if (!AGENCY_ONBOARDING || done.current || !isAuthenticated || user?.role === "admin" || !LANDINGS.has(pathname)) return;
    const agencies = mine.data;
    if (!agencies?.length) return;
    done.current = true;
    const draft = agencies.find((a) => a.status === "draft" && a.role === "owner");
    if (draft && agencies.length === 1) navigate(`/admin/onboarding/${draft.id}`, { replace: true });
  }, [isAuthenticated, user?.role, pathname, mine.data, navigate]);

  return null;
}
