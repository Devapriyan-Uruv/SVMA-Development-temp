import { getOpenAI, OPENAI_MODEL } from '@/lib/openai';

// The ONLY file that imports the raw OpenAI client. Every AI-branded
// capability in the app (report classification, exception narration, the
// operations brief, the assistant) calls aix3Complete() below, never
// getOpenAI()/OPENAI_MODEL directly — this is what makes "one AIX3
// architecture" real instead of cosmetic, and is the one place a future
// model-provider swap would touch. AIX3 is the product's own AI identity;
// the underlying provider (OpenAI today) is never named to end users.

export type Aix3CompleteInput = { instructions: string; input: string; timeout?: number; maxRetries?: number; /** What this call is for — shown in URUV credit usage. */ feature?: string };

export function aix3Enabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function aix3Complete({ instructions, input, timeout = 30000, maxRetries = 0, feature = 'AIX3' }: Aix3CompleteInput): Promise<string> {
  const client = getOpenAI(feature);
  const response = await client.responses.create({ model: OPENAI_MODEL, store: false, instructions, input }, { timeout, maxRetries });
  return String(response.output_text || '').trim();
}

/** Every AIX3 JSON-mode call goes through this rather than each caller
 * reimplementing the same code-fence-stripping regex. */
export function parseAix3Json<T = any>(raw: string): T | null {
  try { return JSON.parse(raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')) as T; } catch { return null; }
}
