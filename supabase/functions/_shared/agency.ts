/**
 * Agency 1, as the chat function fills its prompts.
 *
 * A copy of src/config/agencyProfile.ts, not a read of `agency_profiles`: the
 * tenant migration revokes that table from service_role. Duplicated is fine,
 * drifted is not — tests/contract/chat-prompts.contract.test.ts compares every
 * field. `id` is the agency the tenant migration seeds.
 */
export const AGENCY = {
  id: '00000000-0000-0000-0000-000000000001',
  displayName: 'דורית גוב ארי',
  phoneDisplay: '050-831-1776',
  email: 'dorit@govari-fin.co.il',
  licenceEntity: 'דורית גוב ארי — מתכננת פיננסית וסוכנת ביטוח',
  licenceNumber: 'L-00107009',
  licenceRegulator: 'רשות שוק ההון, ביטוח וחיסכון',
} as const;
