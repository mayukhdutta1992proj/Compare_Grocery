import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { isoLocal } from './summary';
import { GroceryOrder, ORDER_SCHEMA_VERSION, OrdersApi } from './types';

/**
 * Pushes orders to an external dashboard (e.g. the Dutta Family Dashboard,
 * Finance > Total grocery spending). Off until a dashboard URL and token are
 * set in Settings. Contract: docs/ORDER_API.md.
 *
 *   POST {baseUrl}/api/finance/grocery-orders
 *   Authorization: Bearer <token>
 *   { "schemaVersion": 1, "orders": [GroceryOrder, ...] }   (upsert by id; deleted:true = remove)
 *   -> 200 { "accepted": ["ord_..."], "rejected": [{ "id": "...", "error": "..." }] }
 */

export const SYNC_PATH = '/api/finance/grocery-orders';
const URL_KEY = 'dashboard-sync-url';
const TOKEN_KEY = 'dashboard_sync_token';
const LAST_KEY = 'dashboard-sync-last';

export interface SyncConfig {
  baseUrl: string;
  hasToken: boolean;
  lastSyncAt?: string;
  lastError?: string;
}

export async function getSyncConfig(): Promise<SyncConfig> {
  const [baseUrl, token, last] = await Promise.all([
    AsyncStorage.getItem(URL_KEY),
    SecureStore.getItemAsync(TOKEN_KEY),
    AsyncStorage.getItem(LAST_KEY),
  ]);
  const parsed = last ? (JSON.parse(last) as { at?: string; error?: string }) : {};
  return { baseUrl: baseUrl ?? '', hasToken: !!token, lastSyncAt: parsed.at, lastError: parsed.error };
}

export async function setSyncConfig(baseUrl: string, token?: string) {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  if (clean) await AsyncStorage.setItem(URL_KEY, clean);
  else await AsyncStorage.removeItem(URL_KEY);
  if (token !== undefined) {
    if (token.trim()) await SecureStore.setItemAsync(TOKEN_KEY, token.trim());
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

export interface SyncResult {
  sent: number;
  accepted: number;
  rejected: number;
  skipped?: 'not-configured' | 'nothing-to-send';
  error?: string;
}

/** Sends every order not yet accepted by the dashboard. Safe to call repeatedly (the server upserts by id). */
export async function syncOrders(api: OrdersApi): Promise<SyncResult> {
  const [baseUrl, token] = await Promise.all([AsyncStorage.getItem(URL_KEY), SecureStore.getItemAsync(TOKEN_KEY)]);
  if (!baseUrl || !token) return { sent: 0, accepted: 0, rejected: 0, skipped: 'not-configured' };
  if (!/^https:\/\//i.test(baseUrl)) {
    return record({ sent: 0, accepted: 0, rejected: 0, error: 'The dashboard address must start with https://' });
  }
  const pending: GroceryOrder[] = await api.pendingSync();
  if (!pending.length) return { sent: 0, accepted: 0, rejected: 0, skipped: 'nothing-to-send' };

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${SYNC_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ schemaVersion: ORDER_SCHEMA_VERSION, orders: pending }),
    });
  } catch {
    return record({ sent: pending.length, accepted: 0, rejected: 0, error: 'Could not reach the dashboard.' });
  }
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error ?? `HTTP ${res.status}`;
    return record({ sent: pending.length, accepted: 0, rejected: 0, error: `Dashboard refused the sync: ${msg}` });
  }
  const accepted: string[] = Array.isArray(json?.accepted) ? json.accepted : pending.map((o) => o.id);
  const rejected: unknown[] = Array.isArray(json?.rejected) ? json.rejected : [];
  await api.markSynced(accepted, isoLocal());
  return record({ sent: pending.length, accepted: accepted.length, rejected: rejected.length });
}

async function record(r: SyncResult): Promise<SyncResult> {
  await AsyncStorage.setItem(LAST_KEY, JSON.stringify({ at: r.error ? undefined : isoLocal(), error: r.error }));
  return r;
}
