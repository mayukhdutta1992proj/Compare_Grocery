import { PlatformId, Settings } from './types';

export interface PlatformConfig {
  id: PlatformId;
  name: string;
  color: string;
  homeUrl: string;
  searchUrl: (q: string) => string;
  /**
   * "mobile": the store's mobile website (light, like its app). "desktop": its desktop
   * website rendered at desktop width and scaled to fit (heavier; kept as a fallback).
   * Amazon and Instamart use desktop: their mobile sites keep handing you over to their apps.
   */
  site: 'mobile' | 'desktop';
  /** True if the app can type a pincode into the store's own location picker. */
  autoLocation: boolean;
}

export const PLATFORMS: Record<PlatformId, PlatformConfig> = {
  blinkit: {
    id: 'blinkit',
    name: 'Blinkit',
    color: '#0C831F',
    homeUrl: 'https://blinkit.com/',
    searchUrl: (q) => `https://blinkit.com/s/?q=${encodeURIComponent(q)}`,
    site: 'mobile',
    autoLocation: true,
  },
  zepto: {
    id: 'zepto',
    name: 'Zepto',
    color: '#5E1EB5',
    homeUrl: 'https://www.zepto.com/',
    searchUrl: (q) => `https://www.zepto.com/search?query=${encodeURIComponent(q)}`,
    site: 'mobile',
    autoLocation: true,
  },
  instamart: {
    id: 'instamart',
    name: 'Instamart',
    color: '#FC8019',
    homeUrl: 'https://www.swiggy.com/instamart',
    searchUrl: (q) => `https://www.swiggy.com/instamart/search?query=${encodeURIComponent(q)}`,
    site: 'desktop',
    autoLocation: false,
  },
  bigbasket: {
    id: 'bigbasket',
    name: 'BigBasket',
    color: '#84C225',
    homeUrl: 'https://www.bigbasket.com/',
    searchUrl: (q) => `https://www.bigbasket.com/ps/?q=${encodeURIComponent(q)}`,
    site: 'mobile',
    autoLocation: false,
  },
  amazon: {
    id: 'amazon',
    name: 'Amazon Fresh',
    color: '#232F3E',
    homeUrl: 'https://www.amazon.in/alm/storefront?almBrandId=ctnow',
    searchUrl: (q) => `https://www.amazon.in/s?k=${encodeURIComponent(q)}&i=nowstore`,
    site: 'desktop',
    autoLocation: false,
  },
};

/** Every store the app knows, in display order. Use the user's enabled list for anything they see. */
export const PLATFORM_IDS: PlatformId[] = ['blinkit', 'zepto', 'instamart', 'bigbasket', 'amazon'];

/** Builds a per-store record, e.g. allStores(() => 0). */
export function allStores<T>(fn: (pid: PlatformId) => T): Record<PlatformId, T> {
  return Object.fromEntries(PLATFORM_IDS.map((p) => [p, fn(p)])) as Record<PlatformId, T>;
}

export const STORE_NAMES = allStores((p) => PLATFORMS[p].name);

/**
 * Rough fee estimates. They change often and differ by city and membership,
 * so the user can edit them in Settings.
 */
export const DEFAULT_SETTINGS: Settings = {
  blinkit: { deliveryFee: 30, freeDeliveryAbove: 199, handlingFee: 11, smallCartFee: 20, smallCartBelow: 99 },
  zepto: { deliveryFee: 30, freeDeliveryAbove: 199, handlingFee: 13, smallCartFee: 35, smallCartBelow: 99 },
  instamart: { deliveryFee: 30, freeDeliveryAbove: 199, handlingFee: 10, smallCartFee: 25, smallCartBelow: 99 },
  bigbasket: { deliveryFee: 30, freeDeliveryAbove: 299, handlingFee: 0, smallCartFee: 0, smallCartBelow: 0 },
  amazon: { deliveryFee: 30, freeDeliveryAbove: 249, handlingFee: 0, smallCartFee: 0, smallCartBelow: 0 },
};
