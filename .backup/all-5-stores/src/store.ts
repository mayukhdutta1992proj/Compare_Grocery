import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, PLATFORM_IDS } from './platforms';
import { DeliveryLocation, ItemCompare, ListItem, PlatformId, ProductPref, Settings } from './types';

interface Persisted {
  list: ListItem[];
  compares: ItemCompare[];
  settings: Settings;
  location: DeliveryLocation;
  /** Remembered product choices, keyed by the normalised shopping-list line. */
  prefs: Record<string, ProductPref>;
  /** Let Gemini pick the best match (when a Gemini key is saved). */
  aiMatch: boolean;
  /** Stores to compare. Switched-off stores aren't searched and their pages aren't loaded. */
  enabledStores: PlatformId[];
}

const KEY = 'price-compare-state-v1';

const EMPTY: Persisted = { list: [], compares: [], settings: DEFAULT_SETTINGS, location: { query: '', byPlatform: {} }, prefs: {}, aiMatch: true, enabledStores: PLATFORM_IDS };

/** App state that survives restarts. Saved to the phone with AsyncStorage. */
export function usePersistedState() {
  const [state, setState] = useState<Persisted>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const p = JSON.parse(raw) as Partial<Persisted>;
        // Anything mid-flight when the app closed is stale now.
        const compares = (p.compares ?? []).map((c) => ({
          ...c,
          cart: undefined,
          byPlatform: Object.fromEntries(
            Object.entries(c.byPlatform).map(([k, r]) => [k, r.status === 'loading' ? { ...r, status: 'idle' } : r]),
          ) as ItemCompare['byPlatform'],
        }));
        setState({
          list: p.list ?? [],
          compares,
          // Fill in fees for stores added since the settings were saved.
          settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
          location: p.location ?? EMPTY.location,
          prefs: p.prefs ?? {},
          aiMatch: p.aiMatch ?? true,
          // Keep the saved choice, but drop unknown ids; new installs get every store.
          enabledStores: (p.enabledStores ?? PLATFORM_IDS).filter((x) => PLATFORM_IDS.includes(x)),
        });
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // Saving is batched (at most every 1.5 s) and keeps only the top products per store,
    // so streaming results don't keep the phone busy writing large JSON.
    saveTimer.current = setTimeout(() => {
      const slim = {
        ...state,
        compares: state.compares.map((c) => ({
          ...c,
          byPlatform: Object.fromEntries(
            Object.entries(c.byPlatform).map(([k, r]) => [k, r ? { ...r, products: r.products.slice(0, 6) } : r]),
          ),
        })),
      };
      AsyncStorage.setItem(KEY, JSON.stringify(slim)).catch(() => undefined);
    }, 1500);
  }, [state, loaded]);

  const setList = useCallback((fn: (l: ListItem[]) => ListItem[]) => setState((s) => ({ ...s, list: fn(s.list) })), []);
  const setCompares = useCallback(
    (fn: (c: ItemCompare[]) => ItemCompare[]) => setState((s) => ({ ...s, compares: fn(s.compares) })),
    [],
  );
  const setSettings = useCallback((settings: Settings) => setState((s) => ({ ...s, settings })), []);
  const setLocation = useCallback(
    (fn: (l: DeliveryLocation) => DeliveryLocation) => setState((s) => ({ ...s, location: fn(s.location) })),
    [],
  );

  const setPrefs = useCallback(
    (fn: (p: Record<string, ProductPref>) => Record<string, ProductPref>) => setState((s) => ({ ...s, prefs: fn(s.prefs) })),
    [],
  );
  const setAiMatch = useCallback((aiMatch: boolean) => setState((s) => ({ ...s, aiMatch })), []);

  const setEnabledStores = useCallback(
    (enabledStores: PlatformId[]) =>
      setState((s) => ({ ...s, enabledStores: PLATFORM_IDS.filter((p) => enabledStores.includes(p)) })),
    [],
  );

  return { ...state, loaded, setList, setCompares, setSettings, setLocation, setPrefs, setAiMatch, setEnabledStores };
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
