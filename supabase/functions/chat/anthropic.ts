/**
 * The one model provider adapter: the Anthropic Messages API over fetch.
 * Another provider is another file that returns a ModelClient.
 */
import type { SystemBlock } from './prompt.ts';
import type { ToolDefinition } from './tools.ts';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
/** Verified against Anthropic's model list before launch; overridden by the CHAT_MODEL secret. */
export const DEFAULT_CHAT_MODEL = 'claude-haiku-5-5';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ModelRequest {
  system: SystemBlock[];
  messages: ModelMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
  /** 'none': the tools stay listed (the conversation names them) but the model may not call one. */
  toolChoice?: 'none';
}

export interface ModelUsage {
  input: number;
  cached: number;
  output: number;
}

export interface ModelResponse {
  content: ContentBlock[];
  stopReason: string;
  usage: ModelUsage;
  model: string;
}

export class ModelError extends Error {
  constructor(
    public readonly kind: 'http' | 'timeout' | 'network' | 'shape',
    public readonly status?: number,
  ) {
    super(`model_${kind}${status ? `_${status}` : ''}`);
    this.name = 'ModelError';
  }
}

export interface ModelClient {
  readonly model: string;
  complete(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export function createAnthropicClient(opts: { apiKey: string; model: string; fetchImpl?: typeof fetch }): ModelClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    model: opts.model,
    async complete(req, signal) {
      let res: Response;
      try {
        res = await fetchImpl(ANTHROPIC_URL, {
          method: 'POST',
          headers: { 'x-api-key': opts.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: opts.model,
            max_tokens: req.maxTokens,
            system: req.system,
            messages: req.messages,
            tools: req.tools,
            ...(req.toolChoice ? { tool_choice: { type: req.toolChoice } } : {}),
          }),
          signal,
        });
      } catch (e) {
        const name = (e as { name?: string })?.name;
        throw new ModelError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
      }
      if (!res.ok) throw new ModelError('http', res.status);
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!json || !Array.isArray(json.content)) throw new ModelError('shape');
      const u = (json.usage ?? {}) as Record<string, unknown>;
      return {
        content: json.content as ContentBlock[],
        stopReason: typeof json.stop_reason === 'string' ? json.stop_reason : '',
        model: typeof json.model === 'string' ? json.model : opts.model,
        usage: {
          input: count(u.input_tokens) + count(u.cache_creation_input_tokens),
          cached: count(u.cache_read_input_tokens),
          output: count(u.output_tokens),
        },
      };
    },
  };
}
