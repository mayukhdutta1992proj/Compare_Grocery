/**
 * Grocery order records: the public data contract.
 *
 * This shape is what the app stores locally AND what it sends to an external
 * dashboard (see docs/ORDER_API.md). Changing a field is a breaking change:
 * bump ORDER_SCHEMA_VERSION and document it.
 */

export const ORDER_SCHEMA_VERSION = 1 as const;

export type StoreId = 'blinkit' | 'zepto' | 'amazon';

export interface OrderItem {
  /** Product name as the store shows it, e.g. "Tata Salt Vacuum Evaporated Iodised". */
  name: string;
  /** Pack size text, e.g. "1 kg". */
  qty: string;
  /** Price of one pack, in rupees. */
  unitPrice: number;
  /** Number of packs. */
  count: number;
}

export interface GroceryOrder {
  /** Stable unique id (generated on the phone), safe to use as a database key / for upserts. */
  id: string;
  schemaVersion: typeof ORDER_SCHEMA_VERSION;
  store: StoreId;
  /** When the order was placed, ISO 8601 with timezone, e.g. "2026-11-22T19:41:05.000+05:30". */
  placedAt: string;
  items: OrderItem[];
  /** Sum of unitPrice x count, in rupees. */
  itemsTotal: number;
  /** Delivery, handling, small-cart fees etc. (total - itemsTotal), in rupees. */
  fees: number;
  /** What was actually paid, in rupees. This is the number to use for spending totals. */
  total: number;
  currency: 'INR';
  /** "app": saved from the app's cart; "manual": typed in by the user. */
  source: 'app' | 'manual';
  /** The store's own order number, if the user entered it. */
  storeOrderRef?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  /** Set once the order was accepted by the dashboard. */
  syncedAt?: string;
  /** Soft delete, so a deletion can also be synced. */
  deleted?: boolean;
}

export type NewOrder = Omit<GroceryOrder, 'id' | 'schemaVersion' | 'createdAt' | 'updatedAt' | 'syncedAt' | 'deleted' | 'currency'> & {
  currency?: 'INR';
};

export interface OrderQuery {
  /** Inclusive, ISO date or date-time. */
  from?: string;
  /** Exclusive, ISO date or date-time. */
  to?: string;
  store?: StoreId;
}

export interface SpendSummary {
  currency: 'INR';
  from?: string;
  to?: string;
  orderCount: number;
  /** Sum of `total` over the orders in range. */
  totalSpend: number;
  byStore: Record<StoreId, { orders: number; total: number }>;
  /** Calendar months in the phone's timezone, newest first. */
  byMonth: { month: string; orders: number; total: number }[];
}

/** Everything the app (and later the dashboard sync) does with orders goes through this interface. */
export interface OrdersApi {
  list(q?: OrderQuery): Promise<GroceryOrder[]>;
  get(id: string): Promise<GroceryOrder | undefined>;
  create(input: NewOrder): Promise<GroceryOrder>;
  update(id: string, patch: Partial<NewOrder>): Promise<GroceryOrder>;
  remove(id: string): Promise<void>;
  summary(q?: OrderQuery): Promise<SpendSummary>;
  /** Orders created/changed/deleted since the last successful sync (deleted ones included). */
  pendingSync(): Promise<GroceryOrder[]>;
  markSynced(ids: string[], at: string): Promise<void>;
  /** Called whenever orders change, so screens can refresh. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
}
