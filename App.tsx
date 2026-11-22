import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { BrowserLayer, BrowserProvider, useBrowsers } from './src/BrowserHost';
import { Header } from './src/components/Header';
import { LocationSheet } from './src/components/LocationSheet';
import { AI_CANDIDATES, aiPickBest, AiItemInput } from './src/aiMatch';
import { buildPlans, feesFor, Plan, rankProducts, selectedProduct, simplerQueries } from './src/match';
import { findPref, findRemembered, quickAddFromPrefs, recordPref } from './src/prefs';
import { clearCache, getCached, putCached } from './src/searchCache';
import { OcrProvider } from './src/OcrEngine';
import { PLATFORMS, PLATFORM_IDS, STORE_NAMES } from './src/platforms';
import { CompareScreen, effectiveChoice } from './src/screens/CompareScreen';
import { ListScreen } from './src/screens/ListScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ordersApi } from './src/orders/localApi';
import { OrderDraft, OrderSheet } from './src/orders/OrderSheet';
import { OrdersScreen } from './src/orders/OrdersScreen';
import { syncOrders } from './src/orders/sync';
import { NewOrder } from './src/orders/types';
import { newId, usePersistedState } from './src/store';
import { C, R } from './src/theme';
import { CartState, ItemCompare, ListItem, PlatformId, PlatformResult, SearchResult } from './src/types';

type Tab = 'list' | 'compare' | 'accounts' | 'orders' | 'settings';

const TABS: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap; iconOn: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'list', label: 'Basket', icon: 'basket-outline', iconOn: 'basket' },
  { id: 'compare', label: 'Compare', icon: 'pricetags-outline', iconOn: 'pricetags' },
  { id: 'accounts', label: 'Stores', icon: 'storefront-outline', iconOn: 'storefront' },
  { id: 'orders', label: 'Orders', icon: 'receipt-outline', iconOn: 'receipt' },
  { id: 'settings', label: 'Settings', icon: 'settings-outline', iconOn: 'settings' },
];

const TITLES: Record<Exclude<Tab, 'accounts'>, { title: string; subtitle: string }> = {
  list: { title: 'Your basket', subtitle: 'Compare Blinkit and Zepto in one tap.' },
  compare: { title: 'Best prices', subtitle: 'Tap a store tile to buy that item there.' },
  orders: { title: 'Order history', subtitle: 'Your grocery spending, ready for the family dashboard.' },
  settings: { title: 'Settings', subtitle: 'Matching, photo reading, dashboard link and store fees.' },
};

const NAMES = STORE_NAMES;

export default function App() {
  return (
    <SafeAreaProvider>
      <BrowserProvider>
        <OcrProvider>
          <Main />
        </OcrProvider>
      </BrowserProvider>
    </SafeAreaProvider>
  );
}

function Main() {
  const browsers = useBrowsers();
  const store = usePersistedState();
  const { list, compares, settings, location, setList, setCompares, setSettings, setLocation, prefs, setPrefs, aiMatch, setAiMatch } = store;
  const { enabledStores, setEnabledStores } = store;
  const enabledRef = useRef(enabledStores);
  enabledRef.current = enabledStores;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const aiMatchRef = useRef(aiMatch);
  aiMatchRef.current = aiMatch;
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | undefined>();
  const [tab, setTab] = useState<Tab>('list');
  const [accountPid, setAccountPid] = useState<PlatformId>('blinkit');
  const [comparing, setComparing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [locBusy, setLocBusy] = useState<Partial<Record<PlatformId, boolean>>>({});
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const refreshRef = useRef<() => void>(() => undefined);

  // First launch: ask for the pincode, since prices depend on it.
  useEffect(() => {
    if (store.loaded && !location.query) setSheetOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.loaded]);

  const applyLocation = useCallback(
    async (query: string) => {
      clearCache();
      setLocation((l) => ({
        query,
        byPlatform: Object.fromEntries(
          Object.entries(l.byPlatform).filter(([p]) => PLATFORMS[p as PlatformId] && !PLATFORMS[p as PlatformId].autoLocation),
        ),
      }));
      // Only some stores let the app type a pincode; the others are set once on the Stores tab.
      const auto = enabledStores.filter((p) => PLATFORMS[p].autoLocation);
      setLocBusy(Object.fromEntries(auto.map((p) => [p, true])));
      await Promise.all(
        auto.map(async (pid) => {
          const r = await browsers.setLocation(pid, query);
          setLocation((l) => ({ ...l, byPlatform: { ...l.byPlatform, [pid]: { ...r, checkedAt: Date.now() } } }));
          setLocBusy((b) => ({ ...b, [pid]: false }));
        }),
      );
      if (compares.length) {
        Alert.alert('Location updated', 'Prices can differ here. Refresh prices for the new location?', [
          { text: 'Later', style: 'cancel' },
          { text: 'Refresh', onPress: () => refreshRef.current() },
        ]);
      }
    },
    [browsers, setLocation, compares.length, enabledStores],
  );

  // Results arrive from up to five stores at once; applying each one separately would
  // re-render the whole list every time. Queue changes and apply them together.
  const pendingPatches = useRef(new Map<string, ((c: ItemCompare) => ItemCompare)[]>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPatches = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = null;
    const batch = pendingPatches.current;
    if (!batch.size) return;
    pendingPatches.current = new Map();
    setCompares((cs) =>
      cs.map((c) => {
        const fns = batch.get(c.itemId);
        return fns ? fns.reduce((acc, f) => f(acc), c) : c;
      }),
    );
  }, [setCompares]);
  const patchItem = useCallback(
    (itemId: string, fn: (c: ItemCompare) => ItemCompare) => {
      const list = pendingPatches.current.get(itemId) ?? [];
      list.push(fn);
      pendingPatches.current.set(itemId, list);
      if (!flushTimer.current) flushTimer.current = setTimeout(flushPatches, 250);
    },
    [flushPatches],
  );

  const locRef = useRef(location.query);
  locRef.current = location.query;
  // Increases with every comparison run, so an older run that finishes late can't overwrite a newer one.
  const compareRun = useRef(0);

  // The latest basket, for async loops that must skip items removed meanwhile.
  const listRef = useRef(list);
  listRef.current = list;

  /**
   * Searches both stores for just these items and fills in their results.
   * Returns what was found, so Gemini can refine the picks afterwards.
   */
  const searchItems = useCallback(
    async (items: ListItem[], onlyPid?: PlatformId, fresh = false) => {
      const found = new Map<string, Partial<Record<PlatformId, PlatformResult>>>();
      /** Recent results from the cache (unless `fresh`), else load the store's search page. */
      const lookup = async (pid: PlatformId, q: string): Promise<SearchResult> => {
        if (!fresh) {
          const hit = await getCached(pid, locRef.current, q);
          if (hit) return { products: hit };
        }
        const r = await browsers.search(pid, q);
        if (!r.error && !r.cancelled) putCached(pid, locRef.current, q, r.products);
        return r;
      };
      // Each store works through the items in its own WebView; BrowserHost limits how many run at once.
      await Promise.all(
        enabledRef.current.filter((p) => !onlyPid || p === onlyPid).map(async (pid) => {
          for (const item of items) {
            if (!listRef.current.some((l) => l.id === item.id)) continue; // removed while waiting
            let result: PlatformResult;
            try {
              let r = await lookup(pid, item.query);
              if (r.cancelled) return; // a newer comparison took over
              let ranked = rankProducts(item.query, r.products);
              let usedQuery: string | undefined;
              // No close match? Search again with a simpler phrase ("Lizol Yellow 2 Ltrs" -> "lizol"),
              // but keep judging results against everything the user wrote.
              if (!r.error && ranked.weak) {
                for (const q of simplerQueries(item.query)) {
                  const r2 = await lookup(pid, q);
                  if (r2.error || !r2.products.length) continue;
                  const ranked2 = rankProducts(item.query, r2.products);
                  if (!ranked2.weak || !ranked.products.length) {
                    r = r2;
                    ranked = ranked2;
                    usedQuery = q;
                  }
                  if (!ranked2.weak) break;
                }
              }
              const top = ranked.products.slice(0, 10);
              result = r.error
                ? { status: 'error', products: [], error: r.error }
                : {
                    status: 'done',
                    products: top,
                    // With no close match, pick nothing; the user can still choose from Other options.
                    selectedId: ranked.weak ? undefined : top[0]?.id,
                    noMatch: ranked.weak && top.length > 0,
                    usedQuery,
                    warning: r.warning,
                  };
            } catch (e) {
              result = { status: 'error', products: [], error: String(e) };
            }

            // The product the user chose last time for this line wins over everything else.
            const remembered = findPref(prefsRef.current, item.query)?.byPlatform[pid];
            if (remembered && result.status === 'done') {
              let products = result.products;
              let idx = findRemembered(products, remembered);
              if (idx < 0) {
                // Not in today's results: look it up by name on this store.
                try {
                  const r3 = await lookup(pid, remembered.name);
                  const j = r3.error ? -1 : findRemembered(r3.products, remembered);
                  if (j >= 0) {
                    products = [r3.products[j], ...products].slice(0, 10);
                    idx = 0;
                  }
                } catch {
                  // keep the normal pick
                }
              }
              const chosen = idx >= 0 ? products[idx] : undefined;
              if (chosen?.available) {
                products = [chosen, ...products.filter((_, k) => k !== idx)];
                result = { ...result, products, selectedId: chosen.id, noMatch: false, pickedBy: 'history' };
              }
            }

            found.set(item.id, { ...found.get(item.id), [pid]: result });
            // patchItem ignores items that are no longer in the comparison.
            patchItem(item.id, (c) => ({ ...c, byPlatform: { ...c.byPlatform, [pid]: result } }));
          }
        }),
      );
      return found;
    },
    [browsers, patchItem],
  );

  /**
   * Lets Gemini pick the best product per store for the given items (when a
   * Gemini key is saved and the setting is on). Remembered picks and products
   * the user chose by hand are never overridden. On any error, the app's own
   * ranking stays in place.
   */
  const aiRefine = useCallback(
    async (found: Map<string, Partial<Record<PlatformId, PlatformResult>>>) => {
      if (!aiMatchRef.current || !found.size) return;
      const inputs: AiItemInput[] = [];
      for (const [itemId, byP] of found) {
        const item = listRef.current.find((l) => l.id === itemId);
        if (!item) continue;
        const candidates: AiItemInput['candidates'] = {};
        for (const pid of PLATFORM_IDS) {
          const r = byP[pid];
          if (r?.status === 'done' && r.pickedBy !== 'history' && r.products.length) candidates[pid] = r.products.slice(0, AI_CANDIDATES);
        }
        if (Object.keys(candidates).length) inputs.push({ itemId, query: item.query, count: item.count, candidates });
      }
      if (!inputs.length) return;
      setAiBusy(true);
      setAiNote(undefined);
      try {
        const picks = await aiPickBest(inputs);
        if (!picks) return; // no Gemini key saved
        setCompares((cs) =>
          cs.map((c) => {
            const pk = picks[c.itemId];
            const input = inputs.find((x) => x.itemId === c.itemId);
            if (!pk || !input) return c;
            const byPlatform = { ...c.byPlatform };
            for (const pid of PLATFORM_IDS) {
              const idx = pk[pid];
              const cands = input.candidates[pid];
              const cur = byPlatform[pid];
              if (idx === undefined || !cands || !cur || cur.status !== 'done' || cur.pickedBy === 'user' || cur.pickedBy === 'history') continue;
              if (idx < 0) {
                byPlatform[pid] = { ...cur, selectedId: undefined, noMatch: cur.products.length > 0, pickedBy: 'ai' };
              } else {
                const chosen = cands[idx];
                const products = [chosen, ...cur.products.filter((p) => p.id !== chosen.id)];
                byPlatform[pid] = { ...cur, products, selectedId: chosen.id, noMatch: false, pickedBy: 'ai' };
              }
            }
            return { ...c, byPlatform };
          }),
        );
      } catch (e) {
        setAiNote(`Gemini couldn't check the matches (${e instanceof Error ? e.message : String(e)}). Using the app's own matching.`);
      } finally {
        setAiBusy(false);
      }
    },
    [setCompares],
  );

  const loadingRow = (i: ListItem): ItemCompare => ({
    itemId: i.id,
    query: i.query,
    count: i.count,
    byPlatform: Object.fromEntries(enabledRef.current.map((p) => [p, { status: 'loading', products: [] }])),
  });

  /** Full comparison: searches every item again (first run, or "Refresh all prices"). */
  const runCompare = useCallback(async () => {
    if (!list.length) return;
    if (!location.query) {
      setSheetOpen(true);
      return;
    }
    // Already compared? Basket edits are applied as deltas, so just show the results.
    if (compares.length && tab !== 'compare') {
      setTab('compare');
      return;
    }
    browsers.cancelSearches();
    const run = ++compareRun.current;
    setComparing(true);
    setTab('compare');
    pendingPatches.current.clear();
    setCompares(() => list.map(loadingRow));
    const found = await searchItems(list);
    if (run !== compareRun.current) return;
    flushPatches();
    await aiRefine(found);
    if (run !== compareRun.current) return;
    flushPatches();

    // Pre-select the best overall plan (it accounts for delivery fees).
    setCompares((cs) => {
      const best = buildPlans(cs, settingsRef.current, NAMES)[0];
      return best ? cs.map((c) => ({ ...c, choice: best.assignment[c.itemId] })) : cs;
    });
    setComparing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, location.query, compares.length, tab, searchItems, setCompares]);

  /** "Refresh all prices": cancels anything running and loads every store page again (skips the cache). */
  const refreshAll = useCallback(async () => {
    if (!list.length) return;
    browsers.cancelSearches();
    const run = ++compareRun.current;
    setComparing(true);
    pendingPatches.current.clear();
    setCompares(() => list.map(loadingRow));
    const found = await searchItems(list, undefined, true);
    if (run !== compareRun.current) return;
    flushPatches();
    await aiRefine(found);
    if (run !== compareRun.current) return;
    flushPatches();
    setCompares((cs) => {
      const best = buildPlans(cs, settingsRef.current, NAMES)[0];
      return best ? cs.map((c) => ({ ...c, choice: best.assignment[c.itemId] })) : cs;
    });
    setComparing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, comparing, searchItems, setCompares]);

  refreshRef.current = refreshAll;

  /**
   * Keeps the comparison in step with the basket without re-searching
   * everything: removed items are dropped, new items are searched on their
   * own, and quantity changes just update the totals.
   */
  useEffect(() => {
    if (!store.loaded || comparing || !compares.length) return;
    const byId = new Map(compares.map((c) => [c.itemId, c]));
    const ids = new Set(list.map((i) => i.id));
    const added = list.filter((i) => !byId.has(i.id));
    const removed = compares.some((c) => !ids.has(c.itemId));
    const recounted = list.some((i) => byId.has(i.id) && byId.get(i.id)!.count !== i.count);
    const reordered = !added.length && !removed && compares.some((c, idx) => list[idx]?.id !== c.itemId);
    if (!added.length && !removed && !recounted && !reordered) return;

    setCompares((cs) => {
      const cur = new Map(cs.map((c) => [c.itemId, c]));
      return list.map((i) => {
        const c = cur.get(i.id);
        if (!c) return loadingRow(i);
        if (c.count === i.count) return c;
        // Quantity changed: if it's already in a cart, ask the user to update that cart.
        const cart = { ...c.cart };
        for (const pid of PLATFORM_IDS) {
          if (cart[pid]?.state === 'added') cart[pid] = { state: 'error', message: `Quantity changed to ${i.count}. Tap Retry to update the cart.` };
        }
        return { ...c, count: i.count, cart };
      });
    });
    if (added.length) searchItems(added).then(aiRefine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, compares, comparing, store.loaded]);

  /** Removes an item from the basket; offers to take it out of a store cart too. */
  const removeItem = useCallback(
    (itemId: string) => {
      const c = compares.find((x) => x.itemId === itemId);
      const inCarts = PLATFORM_IDS.filter((p) => c?.cart?.[p]?.state === 'added');
      const drop = () => setList((l) => l.filter((i) => i.id !== itemId));
      if (!c || !inCarts.length) {
        drop();
        return;
      }
      Alert.alert(`Remove "${c.query}"?`, `It is already in your ${inCarts.map((p) => NAMES[p]).join(' and ')} cart.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Keep in cart', onPress: drop },
        {
          text: 'Remove from cart too',
          style: 'destructive',
          onPress: async () => {
            for (const p of inCarts) await setCart(itemId, p, 0);
            drop();
          },
        },
      ]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compares, setList],
  );

  const changeCount = (itemId: string, d: number) =>
    setList((l) => l.map((i) => (i.id === itemId ? { ...i, count: Math.max(1, Math.min(20, i.count + d)) } : i)));

  const addItem = (query: string) => {
    const q = query.trim();
    if (!q) return;
    setList((l) =>
      l.some((i) => i.query.toLowerCase() === q.toLowerCase())
        ? l.map((i) => (i.query.toLowerCase() === q.toLowerCase() ? { ...i, count: Math.min(20, i.count + 1) } : i))
        : [...l, { id: newId(), query: q, count: 1 }],
    );
  };

  const setCartState = (itemId: string, pid: PlatformId, state: CartState | undefined) =>
    patchItem(itemId, (c) => ({ ...c, cart: { ...c.cart, [pid]: state } }));

  const setCart = useCallback(
    async (itemId: string, pid: PlatformId, count: number) => {
      const c = compares.find((x) => x.itemId === itemId);
      const p = c && selectedProduct(c, pid);
      if (!c || !p) return { ok: false, error: 'No product selected' };
      setCartState(itemId, pid, { state: 'adding' });
      const r = await browsers.setCartCount(pid, c.query, p.id, count);
      if (!r.ok) setCartState(itemId, pid, { state: 'error', message: r.error ?? 'Failed' });
      else if (count === 0) setCartState(itemId, pid, undefined);
      else {
        setCartState(itemId, pid, { state: 'added', message: r.error });
        // Bought it: remember this product for this line next time.
        setPrefs((pr) => recordPref(pr, c.query, pid, p));
      }
      return r;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compares, browsers],
  );

  /** "Try again" on a failed tile: search just this item on just this store. */
  const retryItem = useCallback(
    async (itemId: string, pid: PlatformId) => {
      const item = listRef.current.find((l) => l.id === itemId);
      if (!item) return;
      patchItem(itemId, (c) => ({ ...c, byPlatform: { ...c.byPlatform, [pid]: { status: 'loading', products: [] } } }));
      await aiRefine(await searchItems([item], pid, true));
    },
    [patchItem, searchItems, aiRefine],
  );

  /** The user picked a product from "Other options": use it now and remember it for next time. */
  const selectProduct = useCallback(
    (itemId: string, pid: PlatformId, productId: string) => {
      const c = compares.find((x) => x.itemId === itemId);
      const product = c?.byPlatform[pid]?.products.find((x) => x.id === productId);
      patchItem(itemId, (cc) => {
        const cur = cc.byPlatform[pid];
        if (!cur) return cc;
        return { ...cc, byPlatform: { ...cc.byPlatform, [pid]: { ...cur, selectedId: productId, noMatch: false, pickedBy: 'user' } } };
      });
      if (c && product) setPrefs((pr) => recordPref(pr, c.query, pid, product));
    },
    [compares, patchItem, setPrefs],
  );

  /** Adds every chosen item (optionally only one store's) that isn't already in its cart. */
  const addAll = useCallback(
    async (onlyPid?: PlatformId) => {
      const todo = compares.filter((c) => {
        const pid = effectiveChoice(c);
        const state = pid ? c.cart?.[pid]?.state : undefined;
        return pid && (!onlyPid || pid === onlyPid) && state !== 'added' && state !== 'adding';
      });
      if (!todo.length) {
        Alert.alert('All set', 'Every chosen item is already in the cart.');
        return;
      }
      // Calls queue up per store inside BrowserHost (one WebView each), so firing them together is fine.
      const results = await Promise.all(todo.map((c) => setCart(c.itemId, effectiveChoice(c)!, c.count)));
      const failed = results.filter((r) => r && !r.ok);
      if (failed.length) {
        Alert.alert(
          `${todo.length - failed.length} of ${todo.length} added`,
          `${failed.length} could not be added. Check the items marked in red, then tap Retry on them.\n\nFirst problem: ${failed[0].error ?? 'unknown'}`,
        );
      }
    },
    [compares, setCart],
  );

  const applyPlan = (plan: Plan) =>
    setCompares((cs) => cs.map((c) => ({ ...c, choice: plan.assignment[c.itemId] ?? c.choice })));

  const openCart = (pid: PlatformId) => {
    setAccountPid(pid);
    setTab('accounts');
  };

  // ---- Order history ----
  const [orderDraft, setOrderDraft] = useState<OrderDraft | null>(null);
  const orderDraftPid = useRef<PlatformId | null>(null);
  const promptedUrls = useRef(new Set<string>());

  /** Opens "Save order" prefilled with what the app put in this store's cart. */
  const openSaveOrder = useCallback(
    (pid: PlatformId) => {
      const inCart = compares.filter((c) => c.cart?.[pid]?.state === 'added');
      // If nothing was added through the app, fall back to the items chosen for this store.
      const picked = inCart.length ? inCart : compares.filter((c) => effectiveChoice(c) === pid);
      const items = picked
        .map((c) => {
          const p = selectedProduct(c, pid);
          return p ? { name: p.name, qty: p.qty, unitPrice: p.price, count: c.count } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x);
      const itemsTotal = items.reduce((sum, it) => sum + it.unitPrice * it.count, 0);
      orderDraftPid.current = pid;
      setOrderDraft({
        store: pid,
        items,
        estFees: itemsTotal ? feesFor(settings[pid], itemsTotal) : 0,
        source: items.length ? 'app' : 'manual',
      });
    },
    [compares, settings],
  );

  const saveOrder = useCallback(
    async (input: NewOrder) => {
      await ordersApi.create(input);
      const pid = orderDraftPid.current;
      setOrderDraft(null);
      // Those cart items are bought now: clear their "In cart" marks.
      if (pid) {
        setCompares((cs) =>
          cs.map((c) => (c.cart?.[pid]?.state === 'added' ? { ...c, cart: { ...c.cart, [pid]: undefined } } : c)),
        );
      }
      syncOrders(ordersApi).catch(() => undefined);
      Alert.alert('Order saved', 'You can see it, and your spending, in the Orders tab.', [
        { text: 'OK' },
        { text: 'Open Orders', onPress: () => setTab('orders') },
      ]);
    },
    [setCompares],
  );

  /**
   * Spots an order confirmation page in a store WebView and offers to save the
   * order. The URL/title patterns are a best guess and only trigger a question.
   */
  const onStorePage = useCallback(
    (pid: PlatformId, url: string, title: string) => {
      const looksLikeConfirmation =
        /(order[-_/]?(success|placed|confirm|confirmed)|payment[-_/]?success|thank[-_]?you|\/order\/[A-Za-z0-9_-]{6,})/i.test(url) ||
        /(order (placed|confirmed|successful)|thank you for (your )?order)/i.test(title);
      if (!looksLikeConfirmation || promptedUrls.current.has(url)) return;
      promptedUrls.current.add(url);
      Alert.alert(
        `Did you just place an order on ${PLATFORMS[pid].name}?`,
        'Save it to your order history so it counts towards your grocery spending.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Save order', onPress: () => openSaveOrder(pid) },
        ],
      );
    },
    [openSaveOrder],
  );

  /**
   * Stores without automatic location take it from what the user chose on the Stores tab.
   * Read the address it shows, so the app reports the
   * real state instead of asking again.
   */
  const refreshManualLocations = useCallback(async () => {
    const manual = enabledRef.current.filter((p) => !PLATFORMS[p].autoLocation);
    await Promise.all(
      manual.map(async (pid) => {
        const found = await browsers.peekLocation(pid);
        // Keep a known address if this page just doesn't show one (e.g. mid-navigation).
        setLocation((l) => {
          // A store can show a default location for guests (e.g. a Mumbai pincode), so check
          // the pincode against the user's one when both are known.
          const want = l.query.match(/\b\d{6}\b/)?.[0];
          const have = found.address?.match(/\b\d{6}\b/)?.[0];
          const r =
            found.ok && want && have && want !== have
              ? { ...found, ok: false, error: `Set to ${have}, not ${want}. Change it on the Stores tab` }
              : found;
          const prev = l.byPlatform[pid];
          if (!found.ok && prev?.ok) return l;
          return { ...l, byPlatform: { ...l.byPlatform, [pid]: { ...r, checkedAt: Date.now() } } };
        });
      }),
    );
  }, [browsers, setLocation]);

  // Check after start-up (pages need a moment to load), and whenever the user leaves the Stores tab.
  const prevTab = useRef(tab);
  useEffect(() => {
    if (prevTab.current === 'accounts' && tab !== 'accounts') refreshManualLocations();
    prevTab.current = tab;
  }, [tab, refreshManualLocations]);
  useEffect(() => {
    if (!store.loaded) return;
    const t = setTimeout(refreshManualLocations, 12000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.loaded]);

  const showBrowser = tab === 'accounts';
  // The store shown on the Stores tab must be one that's switched on.
  const shownPid: PlatformId = enabledStores.includes(accountPid) ? accountPid : enabledStores[0] ?? 'blinkit';
  const locating = PLATFORM_IDS.some((p) => locBusy[p]);

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: showBrowser ? C.card : C.primary }]} edges={['top', 'left', 'right']}>
      <StatusBar style={showBrowser ? 'dark' : 'light'} />

      {showBrowser ? (
        <View style={s.accHeader}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.segment}>
            {enabledStores.map((pid) => {
              const on = shownPid === pid;
              return (
                <Pressable key={pid} onPress={() => setAccountPid(pid)} style={[s.segBtn, on && { backgroundColor: PLATFORMS[pid].color }]}>
                  <Text style={[s.segText, on && { color: C.white }]}>{PLATFORMS[pid].name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={s.accActions}>
            <Text style={s.accHint} numberOfLines={2}>
              Log in once, check out here, then tap Save order.
            </Text>
            <Pressable style={s.saveOrderBtn} onPress={() => openSaveOrder(shownPid)}>
              <Ionicons name="receipt-outline" size={15} color={C.white} />
              <Text style={s.saveOrderText}>Save order</Text>
            </Pressable>
            <Pressable style={s.iconBtn} onPress={() => browsers.goTo(shownPid, PLATFORMS[shownPid].homeUrl)}>
              <Ionicons name="home-outline" size={18} color={C.text} />
            </Pressable>
            <Pressable style={s.iconBtn} onPress={() => browsers.reload(shownPid)}>
              <Ionicons name="refresh" size={18} color={C.text} />
            </Pressable>
          </View>
        </View>
      ) : (
        <Header
          title={TITLES[tab].title}
          subtitle={TITLES[tab].subtitle}
          location={location}
          locating={locating}
          onLocationPress={() => {
            setSheetOpen(true);
            refreshManualLocations();
          }}
          stores={enabledStores}
        />
      )}

      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {/* The store WebViews always stay mounted, behind the screens. */}
        <BrowserLayer visible={showBrowser ? shownPid : null} enabled={enabledStores} onNavigate={onStorePage} />
        {!showBrowser && (
          <View style={[StyleSheet.absoluteFill, { zIndex: 5, backgroundColor: C.bg }]}>
            {tab === 'list' && (
              <ListScreen
                list={list}
                setList={setList}
                onCompare={runCompare}
                comparing={comparing}
                onNeedApiKey={() => setTab('settings')}
                remembered={quickAddFromPrefs(prefs)}
              />
            )}
            {tab === 'compare' && (
              <CompareScreen
                compares={compares}
                settings={settings}
                comparing={comparing}
                onChoose={(id, pid) => patchItem(id, (c) => ({ ...c, choice: pid }))}
                onSelectProduct={selectProduct}
                onSetCart={setCart}
                onApplyPlan={applyPlan}
                onAddAll={() => addAll()}
                onRemove={removeItem}
                onChangeCount={changeCount}
                onAddItem={addItem}
                onRefreshAll={refreshAll}
                aiBusy={aiBusy}
                onRetry={retryItem}
                aiNote={aiNote}
                onAddStore={(pid) => addAll(pid)}
                onOpenCart={openCart}
                onGoToList={() => setTab('list')}
                storeCount={enabledStores.length}
              />
            )}
            {tab === 'orders' && (
              <OrdersScreen
                onAddFromStore={() =>
                  Alert.alert('Save order from which store?', undefined, [
                    ...enabledStores.map((pid) => ({ text: PLATFORMS[pid].name, onPress: () => openSaveOrder(pid) })),
                    { text: 'Cancel', style: 'cancel' as const },
                  ])
                }
              />
            )}
            {tab === 'settings' && (
              <SettingsScreen
                settings={settings}
                setSettings={setSettings}
                aiMatch={aiMatch}
                setAiMatch={setAiMatch}
                rememberedCount={Object.keys(prefs).length}
                enabledStores={enabledStores}
                setEnabledStores={setEnabledStores}
                onForget={() => setPrefs(() => ({}))}
              />
            )}
          </View>
        )}
      </View>

      <SafeAreaView edges={['bottom']} style={s.tabBar}>
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <Pressable key={t.id} style={s.tab} onPress={() => setTab(t.id)}>
              <View style={[s.tabIcon, on && s.tabIconOn]}>
                <Ionicons name={on ? t.iconOn : t.icon} size={22} color={on ? C.primary : C.faint} />
              </View>
              <Text style={[s.tabText, on && s.tabTextOn]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </SafeAreaView>

      <OrderSheet
        visible={!!orderDraft}
        draft={orderDraft ?? undefined}
        onClose={() => setOrderDraft(null)}
        onSave={saveOrder}
      />

      <LocationSheet
        visible={sheetOpen}
        location={location}
        busy={locBusy}
        onClose={() => setSheetOpen(false)}
        onSubmit={(q) => applyLocation(q)}
        stores={enabledStores}
        onOpenStores={() => {
          setSheetOpen(false);
          setTab('accounts');
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    paddingTop: 6,
  },
  tab: { flex: 1, alignItems: 'center', paddingBottom: 6 },
  tabIcon: { paddingHorizontal: 16, paddingVertical: 4, borderRadius: R.pill },
  tabIconOn: { backgroundColor: C.primarySoft },
  tabText: { color: C.faint, fontSize: 11, fontWeight: '700', marginTop: 2 },
  tabTextOn: { color: C.primary },
  accHeader: { padding: 12, borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.card },
  segment: { flexDirection: 'row', backgroundColor: C.bg, borderRadius: R.md, padding: 4, gap: 4 },
  segBtn: { alignItems: 'center', paddingVertical: 9, paddingHorizontal: 14, borderRadius: R.sm },
  segText: { fontWeight: '800', color: C.text },
  accActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  saveOrderBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.primary, borderRadius: R.pill, paddingHorizontal: 12, height: 36 },
  saveOrderText: { color: C.white, fontWeight: '800', fontSize: 12 },
  accHint: { flex: 1, color: C.muted, fontSize: 12 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
});
