/**
 * The system prompt, in the platform design's order: the compliance rules (an
 * agency cannot edit them), the role, then the agency's profile. The first two
 * are identical for every conversation of a role, so the cache breakpoint sits
 * on the role block and both are read from cache after the first call.
 */
import { AGENCY } from '../_shared/agency.ts';
import { PROMPTS } from './prompts.generated.ts';

export type ChatRole = 'interview';

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

const PLACEHOLDER = /\{\{agency\.([A-Za-z]+)\}\}/g;

export function fillPlaceholders(template: string, agency: Readonly<Record<string, string>> = AGENCY): string {
  return template.replace(PLACEHOLDER, (whole, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(agency, key)) throw new Error(`unknown prompt placeholder ${whole}`);
    return agency[key];
  });
}

export function systemBlocks(role: ChatRole): SystemBlock[] {
  return [
    { type: 'text', text: PROMPTS.compliance },
    { type: 'text', text: fillPlaceholders(PROMPTS[role]), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: fillPlaceholders(PROMPTS.profile) },
  ];
}
