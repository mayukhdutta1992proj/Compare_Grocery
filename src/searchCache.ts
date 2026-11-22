import AsyncStorage from '@react-native-async-storage/async-storage';
import { PlatformId, Product } from './types';

/**
 * Remembers search results per store + delivery location + search phrase for a
 * while, like the result caches shopping apps keep. Re-running a comparison then
 * reuses fresh-enough results instantly instead of loading every store page
 * again. "Refresh all prices" bypasses it.
 */

const KEY = 'search-cache-v1';
export const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 400;
const KEEP_PRODUCTS = 12;

interface Entry {
  at: number;
  products: Product[];
}

let cache: Record<string, Entry> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const keyOf = (pid: PlatformId, location: string, query: string) =>
  `${pid}|${location.trim().toLowerCase()}|${query.trim().toLowerCase().replace(/\s+/g, ' ')}`;

async function load(): Promise<Record<string, Entry>> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Record<string, Entry>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!cache) return;
    // Drop expired entries and keep the newest MAX_ENTRIES.
    const now = Date.now();
    const kept = Object.entries(cache)
      .filter(([, e]) => now - e.at < CACHE_TTL_MS)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_ENTRIES);
    cache = Object.fromEntries(kept);
    AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => undefined);
  }, 2000);
}

/** Fresh cached products for this search, or undefined. */
export async function getCached(pid: PlatformId, location: string, query: string): Promise<Product[] | undefined> {
  const c = await load();
  const e = c[keyOf(pid, location, query)];
  if (!e || Date.now() - e.at > CACHE_TTL_MS) return undefined;
  return e.products;
}

export async function putCached(pid: PlatformId, location: string, query: string, products: Product[]) {
  if (!products.length) return; // don't cache failures or empty pages
  const c = await load();
  c[keyOf(pid, location, query)] = { at: Date.now(), products: products.slice(0, KEEP_PRODUCTS) };
  scheduleSave();
}

/** After a cart change the "in cart" flags are stale; simplest is to forget that store's entries. */
export async function clearCache() {
  cache = {};
  await AsyncStorage.removeItem(KEY).catch(() => undefined);
}
