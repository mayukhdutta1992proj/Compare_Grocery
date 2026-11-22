import { GroceryOrder, OrderQuery, SpendSummary, StoreId } from './types';

/** Every store an order can come from (kept here so this file has no app imports). */
export const STORE_IDS: StoreId[] = ['blinkit', 'zepto', 'amazon'];

/** Pure helpers shared by the local API and tests (no React Native imports). */

export function inRange(o: GroceryOrder, q?: OrderQuery): boolean {
  if (o.deleted) return false;
  const t = Date.parse(o.placedAt);
  if (q?.from && t < Date.parse(q.from)) return false;
  if (q?.to && t >= Date.parse(q.to)) return false;
  if (q?.store && o.store !== q.store) return false;
  return true;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "2026-11" in the device's local time. */
export function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function summarize(orders: GroceryOrder[], q?: OrderQuery): SpendSummary {
  const list = orders.filter((o) => inRange(o, q));
  const byStore = Object.fromEntries(STORE_IDS.map((s) => [s, { orders: 0, total: 0 }])) as SpendSummary['byStore'];
  const months = new Map<string, { orders: number; total: number }>();
  let total = 0;
  for (const o of list) {
    total += o.total;
    // Orders saved before a store was removed from the app still count.
    const s = (byStore[o.store] ??= { orders: 0, total: 0 });
    s.orders += 1;
    s.total = round2(s.total + o.total);
    const k = monthKey(o.placedAt);
    const m = months.get(k) ?? { orders: 0, total: 0 };
    months.set(k, { orders: m.orders + 1, total: round2(m.total + o.total) });
  }
  return {
    currency: 'INR',
    from: q?.from,
    to: q?.to,
    orderCount: list.length,
    totalSpend: round2(total),
    byStore,
    byMonth: [...months.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([month, v]) => ({ month, ...v })),
  };
}

/** ISO 8601 with the device's UTC offset, e.g. 2026-11-22T19:41:05.000+05:30. */
export function isoLocal(d = new Date()): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 23);
  return `${local}${sign}${hh}:${mm}`;
}

export function itemsTotalOf(items: { unitPrice: number; count: number }[]): number {
  return round2(items.reduce((s, it) => s + it.unitPrice * it.count, 0));
}
