export type PlatformId = 'blinkit' | 'zepto' | 'instamart' | 'bigbasket' | 'amazon';

export interface Product {
  id: string;
  name: string;
  qty: string;
  price: number;
  mrp: number;
  image: string;
  available: boolean;
  inCart: boolean;
  /** Sponsored listing. */
  ad?: boolean;
  /** Store rating (0-5) and number of ratings, when the store shows them. */
  rating?: number;
  ratingCount?: number;
}

export interface ListItem {
  id: string;
  query: string;
  count: number;
}

export interface PlatformResult {
  status: 'idle' | 'loading' | 'done' | 'error';
  products: Product[];
  selectedId?: string;
  error?: string;
  warning?: string;
  /** Nothing in the results was a close match; no product is picked unless the user chooses one. */
  noMatch?: boolean;
  /** The search phrase actually used, if it was simplified to find a match. */
  usedQuery?: string;
  /** How the selected product was chosen, for a small badge on the tile. */
  pickedBy?: 'history' | 'ai' | 'user';
}

/** A product the user chose before for a shopping-list line, per store. */
export interface ProductPref {
  query: string;
  uses: number;
  lastUsed: number;
  byPlatform: Partial<Record<PlatformId, { id: string; name: string; qty: string }>>;
}

export interface CartState {
  state: 'adding' | 'added' | 'error';
  message?: string;
}

export interface ItemCompare {
  itemId: string;
  query: string;
  count: number;
  /** Results per store; only stores that were searched have an entry. */
  byPlatform: Partial<Record<PlatformId, PlatformResult>>;
  /** Which platform the user is buying this item from. */
  choice?: PlatformId;
  cart?: Partial<Record<PlatformId, CartState>>;
}

export interface FeeSettings {
  deliveryFee: number;
  freeDeliveryAbove: number;
  handlingFee: number;
  smallCartFee: number;
  smallCartBelow: number;
}

export type Settings = Record<PlatformId, FeeSettings>;

export interface SearchResult {
  products: Product[];
  /** The search was dropped because a newer comparison started. */
  cancelled?: boolean;
  error?: string;
  warning?: string;
}

export interface LocationResult {
  ok: boolean;
  /** The store's location has to be chosen by the user on the Stores tab. */
  manual?: boolean;
  address?: string;
  error?: string;
  notServiceable?: boolean;
}

/** What the user asked for, and what each site actually confirmed. */
export interface DeliveryLocation {
  query: string;
  byPlatform: Partial<Record<PlatformId, LocationResult & { checkedAt?: number }>>;
}

export interface AddResult {
  ok: boolean;
  count?: number;
  error?: string;
}
