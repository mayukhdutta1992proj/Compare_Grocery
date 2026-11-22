import { keyTokens } from './match';
import { PlatformId, Product, ProductPref } from './types';

/**
 * Remembers which product the user chose for a shopping-list line on each
 * store ("turmeric powder" -> JK Turmeric Powder 100 g on Zepto), so the next
 * time a similar line comes up that product is picked first.
 */

/** "Turmeric Powder", "turmeric powder 100g" and "Powder turmeric" share one key. */
export function prefKey(query: string): string {
  return [...new Set(keyTokens(query))].sort().join(' ');
}

function words(s: string): Set<string> {
  return new Set(keyTokens(s));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** The remembered choice for this line: same key, or a very similar one ("haldi powder" vs "turmeric powder" won't match; that's fine). */
export function findPref(prefs: Record<string, ProductPref>, query: string): ProductPref | undefined {
  const key = prefKey(query);
  if (!key) return undefined;
  if (prefs[key]) return prefs[key];
  const want = words(query);
  let best: ProductPref | undefined;
  let bestScore = 0.75;
  for (const p of Object.values(prefs)) {
    const s = jaccard(want, words(p.query));
    if (s >= bestScore) {
      best = p;
      bestScore = s;
    }
  }
  return best;
}

/** Finds the remembered product in a fresh result list: same id, or the same name and pack size. */
export function findRemembered(products: Product[], remembered: { id: string; name: string; qty: string }): number {
  const byId = products.findIndex((p) => p.id === remembered.id);
  if (byId >= 0) return byId;
  const want = words(`${remembered.name} ${remembered.qty}`);
  let best = -1;
  let bestScore = 0.8;
  products.forEach((p, i) => {
    const s = jaccard(want, words(`${p.name} ${p.qty}`));
    if (s >= bestScore) {
      best = i;
      bestScore = s;
    }
  });
  return best;
}

export function recordPref(
  prefs: Record<string, ProductPref>,
  query: string,
  pid: PlatformId,
  product: Product,
): Record<string, ProductPref> {
  const key = prefKey(query);
  if (!key) return prefs;
  const cur = prefs[key];
  return {
    ...prefs,
    [key]: {
      query: cur?.query ?? query,
      uses: (cur?.uses ?? 0) + 1,
      lastUsed: Date.now(),
      byPlatform: { ...cur?.byPlatform, [pid]: { id: product.id, name: product.name, qty: product.qty } },
    },
  };
}

/** Remembered lines for Quick add, most used first, with a short brand hint. */
export function quickAddFromPrefs(prefs: Record<string, ProductPref>, limit = 12): { query: string; hint?: string }[] {
  return Object.values(prefs)
    .sort((a, b) => b.uses - a.uses || b.lastUsed - a.lastUsed)
    .slice(0, limit)
    .map((p) => {
      const any = Object.values(p.byPlatform).find(Boolean);
      const brand = any?.name.split(/\s+/)[0];
      const hint = brand && !p.query.toLowerCase().includes(brand.toLowerCase()) ? brand : undefined;
      return { query: p.query, hint };
    });
}
