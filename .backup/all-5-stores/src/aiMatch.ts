import { geminiGenerate, getKey, parseJsonLoose } from './gemini';
import { PLATFORM_IDS } from './platforms';
import { PlatformId, Product } from './types';

/**
 * Asks Gemini to pick, for each shopping-list line, the best product from each
 * store's candidates (already pre-ranked by the app's own rules). One request
 * covers a whole comparison, to stay well inside the free-tier rate limits.
 *
 * Only product names, sizes, prices and ratings are sent, never account data.
 */

export interface AiItemInput {
  itemId: string;
  query: string;
  count: number;
  candidates: Partial<Record<PlatformId, Product[]>>;
}

/** itemId -> store -> index into that store's candidate list, or -1 for "no reasonable match". */
export type AiPicks = Record<string, Partial<Record<PlatformId, number>>>;

export const AI_CANDIDATES = 8;
const BATCH = 20;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    picks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { i: { type: 'INTEGER' }, ...Object.fromEntries(PLATFORM_IDS.map((p) => [p, { type: 'INTEGER' }])) },
        required: ['i'],
      },
    },
  },
  required: ['picks'],
};

const RULES = `You pick grocery products for an Indian shopper comparing quick-commerce stores (Blinkit, Zepto,
Swiggy Instamart, BigBasket, Amazon Fresh).
For each shopping-list line, choose the single best product from each store's numbered candidates.
Rules, in order:
1. It must be the same kind of product the shopper means. Read the whole line: "Engine cooking oil" means the
   Engine brand of edible (mustard) oil, never motor oil; "Lizol" means the floor cleaner; "Nutri Choice" means
   Britannia NutriChoice biscuits. Hindi words count (namak = salt, chini = sugar, haldi = turmeric, tel = oil).
2. If a brand is written, choose that brand when it is a candidate.
3. If a size is written, choose that size (or the closest). If not, choose the usual household size for that item.
4. Among equally good matches, prefer the lower price per kg/litre/piece and the higher rating count; avoid
   sponsored ("ad") items when an equivalent non-sponsored one exists.
5. If no candidate is a reasonable match, use -1 for that store. Also use -1 when a store has no candidates.
Answer with JSON only: {"picks":[{"i":<line number>,"<store>":<candidate number or -1>, ...one key per store listed for that line}]}`;

function describe(p: Product, n: number): string {
  const bits = [`${n}. ${p.name}`, p.qty || '', `₹${p.price}${p.mrp > p.price ? ` (MRP ₹${p.mrp})` : ''}`];
  if (p.ratingCount) bits.push(`rating ${p.rating ?? '?'} from ${p.ratingCount} ratings`);
  if (p.ad) bits.push('ad');
  if (!p.available) bits.push('OUT OF STOCK');
  return bits.filter(Boolean).join(' | ');
}

function promptFor(items: AiItemInput[]): string {
  const lines = items.map((it, i) => {
    // Only the stores that were searched for this line.
    const stores = PLATFORM_IDS.filter((pid) => it.candidates[pid]).map((pid) => {
      const c = it.candidates[pid] ?? [];
      const body = c.length ? c.map((p, n) => `    ${describe(p, n)}`).join('\n') : '    (no candidates)';
      return `  ${pid}:\n${body}`;
    }).join('\n');
    return `Line ${i}: "${it.query}" x${it.count}\n${stores}`;
  });
  return `${RULES}\n\n${lines.join('\n\n')}`;
}

/** Returns picks, or null if no Gemini key is saved. Throws on API errors so the caller can fall back. */
export async function aiPickBest(items: AiItemInput[]): Promise<AiPicks | null> {
  const key = await getKey('gemini');
  if (!key || !items.length) return null;
  const out: AiPicks = {};
  for (let start = 0; start < items.length; start += BATCH) {
    const chunk = items.slice(start, start + BATCH);
    const text = await geminiGenerate(key, [{ text: promptFor(chunk) }], SCHEMA, 'gemini-match');
    const data = parseJsonLoose(text);
    const picks: any[] = Array.isArray(data?.picks) ? data.picks : Array.isArray(data) ? data : [];
    for (const pk of picks) {
      const idx = Number(pk?.i);
      const it = chunk[idx];
      if (!it) continue;
      const res: Partial<Record<PlatformId, number>> = {};
      for (const pid of PLATFORM_IDS) {
        const v = Number(pk?.[pid]);
        const n = (it.candidates[pid] ?? []).length;
        if (Number.isInteger(v) && v >= -1 && v < n) res[pid] = v;
      }
      out[it.itemId] = res;
    }
  }
  return out;
}
