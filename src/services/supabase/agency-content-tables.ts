/**
 * What the public site reads of an agency, by table and column.
 *
 * scripts/prerender.mjs imports this file under Node to refuse these reads at
 * build time (R4), so it stays erasable TypeScript: no aliases, no enums, no
 * imports.
 */

export const AGENCY_CONTENT_TABLES = ["public_agency_sites", "public_agent_cards", "success_cases"] as const;

/** `service_area` is left out: nothing on the site shows it yet. */
export const SITE_COLUMNS =
  "agency_id,domain,display_name,phone_e164,phone_display,whatsapp,email,default_whatsapp_message";

export const CARD_COLUMNS =
  "id,agency_id,full_name,professional_title,photo_path,photo_alt,licence_number,bio,stats,booking_url,review_links";

export const SUCCESS_CASE_COLUMNS = "id,tag,title,body,metric,metric_is_estimate,sort_order";
