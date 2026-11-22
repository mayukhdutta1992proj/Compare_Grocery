import * as SecureStore from 'expo-secure-store';

/**
 * API keys and a small Gemini client shared by photo reading and product
 * matching. Keys live in the iPhone keychain (expo-secure-store).
 *
 * Gemini's free tier (a Google AI Studio key) has rate limits, and Google may
 * use free-tier content to improve its products.
 */

export type AiProvider = 'gemini' | 'claude';

const KEY_ITEMS: Record<AiProvider, string> = { claude: 'anthropic_api_key', gemini: 'gemini_api_key' };

export const getKey = (p: AiProvider) => SecureStore.getItemAsync(KEY_ITEMS[p]);
export const setKey = (p: AiProvider, key: string) =>
  key.trim() ? SecureStore.setItemAsync(KEY_ITEMS[p], key.trim()) : SecureStore.deleteItemAsync(KEY_ITEMS[p]);

export class NeedsApiKeyError extends Error {}

/** Free-tier models, cheapest first. If Google retires one, the next is tried. */
export const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-2.5-flash-lite'];

/**
 * Calls Gemini generateContent and returns the answer text (thinking parts are
 * dropped). Asks for JSON with `schema`, and retries without the schema if a
 * model rejects it; moves to the next model if one is missing or rate-limited.
 */
export async function geminiGenerate(apiKey: string, parts: unknown[], schema?: object, tag = 'gemini'): Promise<string> {
  const makeBody = (withSchema: boolean) =>
    JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig:
        withSchema && schema ? { responseMimeType: 'application/json', responseSchema: schema } : { responseMimeType: 'application/json' },
    });

  let lastError = 'Gemini did not respond.';
  for (const model of GEMINI_MODELS) {
    for (const withSchema of schema ? [true, false] : [false]) {
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: makeBody(withSchema),
        });
      } catch {
        throw new Error('No internet connection to Gemini.');
      }
      const json: any = await res.json().catch(() => null);
      const msg: string = json?.error?.message ?? `HTTP ${res.status}`;
      // Shows up in the Expo server log on the PC (no key, image or list content is logged).
      console.warn(`[${tag}] ${model} schema=${withSchema} -> ${res.status}${res.ok ? '' : `: ${msg.slice(0, 200)}`}`);

      if (res.status === 404) {
        lastError = `Gemini model ${model} is not available: ${msg}`;
        break; // next model
      }
      if (res.status === 400 && /api key/i.test(msg)) throw new NeedsApiKeyError('Your Gemini key was rejected. Check it in the Settings tab.');
      if (res.status === 401 || res.status === 403) throw new NeedsApiKeyError(`Gemini refused the key: ${msg}`);
      if (res.status === 429) {
        lastError = 'Gemini free-tier limit reached for now. Try again in a minute (or tomorrow if the daily limit is used up).';
        break; // another model may have its own free quota
      }
      if (res.status === 400 && withSchema) {
        lastError = `Gemini error: ${msg}`;
        continue; // retry this model without the schema
      }
      if (!res.ok) {
        lastError = `Gemini error: ${msg}`;
        break;
      }
      const out: any[] = json?.candidates?.[0]?.content?.parts ?? [];
      const text = out
        .filter((p) => !p?.thought)
        .map((p) => p?.text ?? '')
        .join('');
      if (text) return text;
      const reason = json?.promptFeedback?.blockReason ?? json?.candidates?.[0]?.finishReason;
      lastError = `Gemini returned no result${reason ? ` (${reason})` : ''}.`;
    }
  }
  throw new Error(lastError);
}

/** Pulls the first JSON object/array out of model text (handles ``` fences and stray words). */
export function parseJsonLoose(text: string): any {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const tries = [cleaned];
  const o = cleaned.indexOf('{');
  const a = cleaned.indexOf('[');
  if (o >= 0) tries.push(cleaned.slice(o, cleaned.lastIndexOf('}') + 1));
  if (a >= 0) tries.push(cleaned.slice(a, cleaned.lastIndexOf(']') + 1));
  for (const t of tries) {
    try {
      return JSON.parse(t);
    } catch {
      // try the next shape
    }
  }
  return null;
}
