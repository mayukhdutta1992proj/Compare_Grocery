import AsyncStorage from '@react-native-async-storage/async-storage';
import { isoLocal, itemsTotalOf, inRange, summarize } from './summary';
import { GroceryOrder, NewOrder, ORDER_SCHEMA_VERSION, OrderQuery, OrdersApi } from './types';

/**
 * OrdersApi backed by the phone's storage (AsyncStorage). The Orders screen
 * uses only the OrdersApi interface, so this could be swapped for a remote
 * implementation (the dashboard) without changing any screen.
 */

const KEY = 'grocery-orders-v1';

const newId = () =>
  `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export function createLocalOrdersApi(): OrdersApi {
  let cache: GroceryOrder[] | null = null;
  const listeners = new Set<() => void>();

  async function load(): Promise<GroceryOrder[]> {
    if (cache) return cache;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      cache = raw ? (JSON.parse(raw) as GroceryOrder[]) : [];
    } catch {
      cache = [];
    }
    return cache;
  }

  async function save(next: GroceryOrder[]) {
    cache = next;
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    listeners.forEach((fn) => fn());
  }

  const byNewest = (a: GroceryOrder, b: GroceryOrder) => Date.parse(b.placedAt) - Date.parse(a.placedAt);

  return {
    async list(q?: OrderQuery) {
      return (await load()).filter((o) => inRange(o, q)).sort(byNewest);
    },
    async get(id) {
      return (await load()).find((o) => o.id === id && !o.deleted);
    },
    async create(input: NewOrder) {
      const now = isoLocal();
      const order: GroceryOrder = {
        ...input,
        id: newId(),
        schemaVersion: ORDER_SCHEMA_VERSION,
        currency: 'INR',
        itemsTotal: input.itemsTotal ?? itemsTotalOf(input.items),
        createdAt: now,
        updatedAt: now,
      };
      await save([...(await load()), order]);
      return order;
    },
    async update(id, patch) {
      const all = await load();
      const cur = all.find((o) => o.id === id);
      if (!cur) throw new Error('Order not found');
      const next: GroceryOrder = { ...cur, ...patch, updatedAt: isoLocal(), syncedAt: undefined };
      if (patch.items) next.itemsTotal = itemsTotalOf(patch.items);
      await save(all.map((o) => (o.id === id ? next : o)));
      return next;
    },
    async remove(id) {
      const all = await load();
      await save(all.map((o) => (o.id === id ? { ...o, deleted: true, updatedAt: isoLocal(), syncedAt: undefined } : o)));
    },
    async summary(q?: OrderQuery) {
      return summarize(await load(), q);
    },
    async pendingSync() {
      return (await load()).filter((o) => !o.syncedAt);
    },
    async markSynced(ids, at) {
      const set = new Set(ids);
      await save((await load()).map((o) => (set.has(o.id) ? { ...o, syncedAt: at } : o)));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** The one instance the app uses. */
export const ordersApi = createLocalOrdersApi();
