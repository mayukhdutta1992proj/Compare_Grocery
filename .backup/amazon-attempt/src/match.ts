import { FeeSettings, ItemCompare, PlatformId, Product, Settings } from './types';
import { PLATFORM_IDS } from './platforms';

/** Parses "1 pack (100 g)", "2 x 500 ml", "1 ltr", "6 pcs" into a base unit. */
export function parseSize(text: string): { amount: number; unit: 'g' | 'ml' | 'pc' } | null {
  const t = text.toLowerCase().replace(/,/g, '');
  const m = t.match(/(?:(\d+(?:\.\d+)?)\s*x\s*)?(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|gram|grams|ml|l|ltr|litre|liter|litres|pc|pcs|piece|pieces|units?|dozen)\b/);
  if (!m) return null;
  const mult = m[1] ? parseFloat(m[1]) : 1;
  let n = parseFloat(m[2]) * mult;
  const u = m[3];
  if (u.startsWith('kg')) return { amount: n * 1000, unit: 'g' };
  if (u.startsWith('g')) return { amount: n, unit: 'g' };
  if (u === 'ml') return { amount: n, unit: 'ml' };
  if (u.startsWith('l')) return { amount: n * 1000, unit: 'ml' };
  if (u === 'dozen') n *= 12;
  return { amount: n, unit: 'pc' };
}

export function unitPriceLabel(p: Product): string | null {
  const s = parseSize(p.qty) ?? parseSize(p.name);
  if (!s || s.amount <= 0) return null;
  if (s.unit === 'pc') return s.amount > 1 ? `₹${(p.price / s.amount).toFixed(1)}/pc` : null;
  const per = (p.price / s.amount) * 100;
  return `₹${per.toFixed(1)}/100${s.unit}`;
}

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]/g, ' ').split(/\s+/).filter((t) => t.length > 1);
}

const hayOf = (p: Product) => ` ${tokens(p.name + ' ' + p.qty).join(' ')} `;

// Words that say nothing about *which* product is wanted.
const STOP = new Set([
  'of', 'the', 'and', 'with', 'for', 'in', 'pack', 'packet', 'packets', 'pkt', 'pcs', 'pc', 'piece', 'pieces',
  'ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters', 'kg', 'kgs', 'gm', 'gms', 'gram', 'grams', 'ml', 'nos',
  'no', 'combo', 'buy', 'some', 'any', 'good', 'best', 'pouch', 'bottle', 'jar', 'box', 'bag',
  // Size words describe the pack, not the product ("Large Marie biscuit"); see SIZE_BIG / SIZE_SMALL.
  'large', 'big', 'bigger', 'small', 'smaller', 'medium', 'mini', 'jumbo', 'family', 'value', 'economy', 'bulk',
  'mega', 'king', 'size', 'sized',
]);

/** "Large", "family pack", "jumbo"... => prefer the biggest pack; "small", "mini" => the smallest. */
const SIZE_BIG = /\b(large|big|bigger|jumbo|family|value|economy|bulk|mega|king size)\b/i;
const SIZE_SMALL = /\b(small|smaller|mini|trial|travel)\b/i;

// Words that mean the same thing on Indian grocery apps (Hindi/English, singular/plural).
const SYNONYM_GROUPS: string[][] = [
  ['salt', 'namak'], ['sugar', 'chini', 'shakkar'], ['atta', 'flour', 'aata'], ['curd', 'dahi', 'yogurt', 'yoghurt'],
  ['milk', 'doodh'], ['egg', 'eggs', 'anda', 'ande'], ['onion', 'onions', 'pyaz', 'pyaaz', 'kanda'],
  ['potato', 'potatoes', 'aloo', 'alu'], ['tomato', 'tomatoes', 'tamatar'], ['rice', 'chawal'],
  ['dal', 'daal', 'dhal', 'lentil', 'lentils'], ['paneer', 'cottage'], ['oil', 'tel', 'oils'],
  ['coriander', 'dhaniya', 'dhania'], ['chilli', 'chili', 'mirch', 'chillies'], ['biscuit', 'biscuits', 'cookies'],
  ['soap', 'sabun'], ['tea', 'chai'], ['ginger', 'adrak'], ['garlic', 'lahsun', 'lehsun'], ['turmeric', 'haldi'],
  ['detergent', 'washing'], ['banana', 'bananas', 'kela'], ['apple', 'apples', 'seb'], ['lemon', 'lemons', 'nimbu'],
  ['butter', 'makhan'], ['jaggery', 'gur', 'gud'], ['semolina', 'suji', 'sooji', 'rava'], ['besan', 'gram flour'],
  ['noodles', 'noodle'], ['chips', 'wafers'], ['cleaner', 'disinfectant'],
];
const SYNONYMS = new Map<string, string[]>();
for (const g of SYNONYM_GROUPS) for (const w of g) SYNONYMS.set(w, g);

/** Things that are almost never what a grocery list means unless asked for by name. */
const NON_GROCERY =
  /\b(bed ?sheets?|bedsheets?|pillows?|curtains?|blankets?|quilts?|comforters?|towels?|t-?shirts?|shirts?|sarees?|kurtas?|jeans|shoes?|sandals?|slippers?|phones?|mobiles?|chargers?|earphones?|headphones?|earbuds|cables?|watch(es)?|toys?|helmets?|scooters?|bikes?|motorcycles?|cars?|tyres?|10w-?\d0|15w-?\d0|20w-?\d0|2t|4t|tc cotton|king size|queen size)\b/i;

const EDIBLE_OIL =
  /\b(mustard|sunflower|groundnut|peanut|soya|soyabean|soybean|rice bran|olive|sesame|til|kachi ghani|refined|filtered|cooking|edible|vanaspati|ghee|canola|coconut)\b/i;
const NON_EDIBLE_OIL =
  /\b(engine oil|motor oil|motul|castrol|servo|gear oil|10w|20w|15w|2t|4t|hair|massage|body|baby oil|lamp|pooja|puja|essential|aroma|beard)\b/i;
const OIL_BRANDS =
  /\b(fortune|saffola|dhara|sundrop|gemini|emami|figaro|postman|patanjali|engine|nature fresh|freedom|gold winner|kachi ghani|dalda|ruchi gold|p mark)\b/i;

function tokenMatches(t: string, hay: string): number {
  if (hay.includes(` ${t} `)) return 1;
  for (const syn of SYNONYMS.get(t) ?? []) if (syn !== t && hay.includes(` ${syn} `)) return 1;
  if (t.length >= 4 && hay.includes(` ${t}`)) return 0.8; // prefix: "biscuit" ~ "biscuits"
  if (t.endsWith('s') && t.length >= 4 && hay.includes(` ${t.slice(0, -1)}`)) return 0.8;
  // Inside a joined brand word: "choice" in "nutrichoice", "flakes" in "cornflakes".
  if (t.length >= 5 && hay.includes(t)) return 0.8;
  // Typed as one word, written as two: "nutrichoice" vs "Nutri Choice".
  if (t.length >= 6 && hay.replace(/\s+/g, '').includes(t)) return 0.8;
  return 0;
}

/** "Nutri Choice" vs "NutriChoice", "Corn Flakes" vs "Cornflakes": compare with spaces removed. */
function joinedMatch(keys: string[], hay: string): boolean {
  if (keys.length < 2) return false;
  const squashed = hay.replace(/\s+/g, '');
  return squashed.includes(keys.join(''));
}

/** Words of the query that identify the product (no sizes, numbers or filler). */
export function keyTokens(query: string): string[] {
  return tokens(query.replace(/\d+(\.\d+)?\s*(kg|kgs|g|gm|gms|ml|l|ltrs?|litres?|liters?|pcs?|pack)\b/gi, ' ')).filter(
    (t) => !STOP.has(t) && !/^\d+$/.test(t),
  );
}

export interface MatchInfo {
  /** 0..1: share of the query's identifying words found in the product name. */
  coverage: number;
  /** Large negative when the product is the wrong kind of thing (bedsheet for "Lizol", motor oil for "cooking oil"). */
  intent: number;
}

/** How well one product matches what the user typed. */
export function matchInfo(query: string, p: Product): MatchInfo {
  const q = keyTokens(query);
  const hay = hayOf(p);
  let got = 0;
  for (const t of q) got += tokenMatches(t, hay);
  const coverage = joinedMatch(q, hay) ? 1 : q.length ? got / q.length : 0;

  let intent = 0;
  const name = `${p.name} ${p.qty}`;
  if (NON_GROCERY.test(name) && !NON_GROCERY.test(query)) intent -= 3;
  const wantsOil = /\b(oil|tel)\b/i.test(query);
  const edibleIntent = wantsOil && (EDIBLE_OIL.test(query) || OIL_BRANDS.test(query));
  if (edibleIntent) {
    // "Engine" is also a mustard-oil brand, so it doesn't count as asking for motor oil.
    if (NON_EDIBLE_OIL.test(name) && !NON_EDIBLE_OIL.test(query.replace(/\bengine\b/gi, ''))) intent -= 3;
    else if (EDIBLE_OIL.test(name)) intent += 0.3;
  }
  return { coverage, intent };
}

/** Kept for callers that only want one number. */
export function matchScore(query: string, p: Product): number {
  const m = matchInfo(query, p);
  return m.coverage + m.intent;
}

function unitPrice(p: Product): number | null {
  const s = parseSize(p.qty) ?? parseSize(p.name);
  if (!s || s.amount <= 0) return null;
  return p.price / s.amount;
}

function sizeKey(p: Product): string | null {
  const s = parseSize(p.qty) ?? parseSize(p.name);
  return s ? `${Math.round(s.amount)}${s.unit}` : null;
}

export interface RankResult {
  products: Product[];
  /** True when nothing was a close match (best product misses key words or is the wrong kind of thing). */
  weak: boolean;
}

/**
 * Orders products for one shopping-list line:
 *  1. must match the words you typed (brand first, synonyms understood) and be the right kind of thing
 *  2. then the size you asked for, or the most common pack size if you gave none
 *  3. then lowest price per kg/litre/piece, popularity (rating count), not sponsored, and the store's own order
 */
export function rankProducts(query: string, products: Product[]): RankResult {
  if (!products.length) return { products: [], weak: true };
  const keys = keyTokens(query);
  const infos = products.map((p, i) => ({ p, i, m: matchInfo(query, p), hay: hayOf(p) }));

  // A word that some product in the results has (e.g. the brand) but this one lacks is a strong miss.
  const achievable = keys.filter((t) => infos.some((x) => tokenMatches(t, x.hay) > 0));
  const firstKey = keys[0];

  const scored = infos.map((x) => {
    let ach = 0;
    for (const t of achievable) ach += tokenMatches(t, x.hay);
    const achCov = achievable.length ? ach / achievable.length : 0;
    return { ...x, match: 0.6 * x.m.coverage + 0.4 * achCov + x.m.intent };
  });
  const bestMatch = Math.max(...scored.map((x) => x.match));
  // "Good" matches: within a small margin of the best one, available, and the right kind of thing.
  const good = scored.filter((x) => x.p.available && x.match >= bestMatch - 0.15 && x.m.intent > -1);

  // Size: what was asked; else "large"/"small" => biggest/smallest pack; else the most common size.
  const want = parseSize(query);
  let targetSize: string | null = want ? `${Math.round(want.amount)}${want.unit}` : null;
  const sizeWord = !want && SIZE_BIG.test(query) ? 'big' : !want && SIZE_SMALL.test(query) ? 'small' : null;
  if (!targetSize && sizeWord) {
    const sized = good
      .map((x) => parseSize(x.p.qty) ?? parseSize(x.p.name))
      .filter((z): z is NonNullable<ReturnType<typeof parseSize>> => !!z);
    if (sized.length) {
      // Compare within the most common unit (g, ml or pc).
      const unit = ['g', 'ml', 'pc'].sort((a, b) => sized.filter((z) => z.unit === b).length - sized.filter((z) => z.unit === a).length)[0];
      const amounts = sized.filter((z) => z.unit === unit).map((z) => z.amount);
      const pick = sizeWord === 'big' ? Math.max(...amounts) : Math.min(...amounts);
      targetSize = `${Math.round(pick)}${unit}`;
    }
  }
  if (!targetSize) {
    const counts = new Map<string, number>();
    for (const x of good) {
      const k = sizeKey(x.p);
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let bestN = 1;
    for (const [k, c] of counts) {
      if (c > bestN) {
        bestN = c;
        targetSize = k;
      }
    }
  }

  // Price per unit, compared only among good matches of the target size when there is one.
  const priced = good.filter((x) => !targetSize || sizeKey(x.p) === targetSize);
  const ups = (priced.length > 1 ? priced : good).map((x) => unitPrice(x.p)).filter((u): u is number => u !== null);
  const minUp = Math.min(...ups);
  const maxUp = Math.max(...ups);
  const maxPop = Math.max(1, ...good.map((x) => x.p.ratingCount ?? 0));
  const n = products.length;

  const final = scored.map((x) => {
    let score = x.match * 10;
    if (!x.p.available) score -= 20;
    const k = sizeKey(x.p);
    if (targetSize && k === targetSize) score += want || sizeWord ? 1.5 : 0.8;
    else if (want && k) score -= 0.6;
    const up = unitPrice(x.p);
    if (up !== null && ups.length > 1 && maxUp > minUp) score += 1.2 * Math.max(0, Math.min(1, (maxUp - up) / (maxUp - minUp)));
    if (x.p.ratingCount) score += 0.8 * (Math.log10(x.p.ratingCount + 1) / Math.log10(maxPop + 1));
    if (x.p.ad) score -= 0.4;
    score += 0.4 * (1 - x.i / n); // the store's own relevance order, as a light tie-breaker
    return { p: x.p, score, intent: x.m.intent, coverage: x.m.coverage, hay: x.hay };
  });
  final.sort((a, b) => b.score - a.score);

  const top = final[0];
  const missesFirstKey = !!firstKey && tokenMatches(firstKey, top.hay) === 0;
  // Show a result whenever it matches at least one of the main words and is the right kind of thing.
  // Only "no main word at all", the wrong kind of product, or missing the brand (first word) while
  // matching less than half counts as "no close match".
  const weak = !top.p.available || top.intent <= -1 || top.coverage === 0 || (missesFirstKey && keys.length > 1 && top.coverage < 0.5);
  return { products: final.map((x) => x.p), weak };
}

/** Shorter search phrases for a retry: drops sizes, numbers and colour words, then keeps just the first (brand) word. */
export function simplerQueries(query: string): string[] {
  const keys = keyTokens(query).filter(
    (t) => !/^(yellow|red|green|blue|white|black|pink|orange|purple|brown|small|big|large|medium|new|fresh)$/.test(t),
  );
  const out: string[] = [];
  const joined = keys.join(' ');
  if (joined && joined !== query.trim().toLowerCase()) out.push(joined);
  if (keys.length > 1 && keys[0].length >= 3) out.push(keys[0]);
  return [...new Set(out)];
}

export function selectedProduct(c: ItemCompare, pid: PlatformId): Product | undefined {
  const r = c.byPlatform[pid];
  if (!r || r.status !== 'done') return undefined;
  // With no close match, nothing is picked until the user chooses from "Other options".
  if (r.noMatch && !r.selectedId) return undefined;
  const p = r.products.find((x) => x.id === r.selectedId) ?? r.products[0];
  return p && p.available ? p : undefined;
}

export function lineTotal(c: ItemCompare, pid: PlatformId): number | undefined {
  const p = selectedProduct(c, pid);
  return p ? p.price * c.count : undefined;
}

/** Cheapest platform for one item, by line total. */
export function cheapestFor(c: ItemCompare): PlatformId | undefined {
  let best: PlatformId | undefined;
  let bestTotal = Infinity;
  for (const pid of PLATFORM_IDS) {
    const t = lineTotal(c, pid);
    if (t !== undefined && t < bestTotal) {
      best = pid;
      bestTotal = t;
    }
  }
  return best;
}

export function feesFor(f: FeeSettings, subtotal: number): number {
  if (subtotal <= 0) return 0;
  let fee = f.handlingFee;
  if (subtotal < f.freeDeliveryAbove) fee += f.deliveryFee;
  if (subtotal < f.smallCartBelow) fee += f.smallCartFee;
  return fee;
}

export interface Plan {
  key: string;
  label: string;
  assignment: Record<string, PlatformId>;
  subtotals: Partial<Record<PlatformId, number>>;
  fees: number;
  total: number;
  missing: string[];
}

function buildPlan(
  key: string,
  label: string,
  compares: ItemCompare[],
  settings: Settings,
  pick: (c: ItemCompare) => PlatformId | undefined,
): Plan {
  const assignment: Record<string, PlatformId> = {};
  const subtotals: Partial<Record<PlatformId, number>> = {};
  const missing: string[] = [];
  for (const c of compares) {
    const pid = pick(c);
    const t = pid ? lineTotal(c, pid) : undefined;
    if (!pid || t === undefined) {
      missing.push(c.query);
      continue;
    }
    assignment[c.itemId] = pid;
    subtotals[pid] = (subtotals[pid] ?? 0) + t;
  }
  let fees = 0;
  let total = 0;
  for (const pid of PLATFORM_IDS) {
    const s = subtotals[pid] ?? 0;
    const f = feesFor(settings[pid], s);
    fees += f;
    total += s + f;
  }
  return { key, label, assignment, subtotals, fees, total, missing };
}

export function buildPlans(compares: ItemCompare[], settings: Settings, names: Record<PlatformId, string>): Plan[] {
  // Only stores that were actually searched (switched-off stores have no results).
  const searched = PLATFORM_IDS.filter((pid) => compares.some((c) => c.byPlatform[pid]));
  const plans = searched.map((pid) =>
    buildPlan(pid, `Everything on ${names[pid]}`, compares, settings, (c) => (lineTotal(c, pid) !== undefined ? pid : undefined)),
  );
  plans.push(buildPlan('split', 'Cheapest of each item (split order)', compares, settings, cheapestFor));
  // Fewest missing items first, then the lowest total.
  return plans.sort((a, b) => a.missing.length - b.missing.length || a.total - b.total);
}
