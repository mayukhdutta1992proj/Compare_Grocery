import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { allStores, PLATFORMS, PLATFORM_IDS } from './platforms';
import { addScript, extractScript, navigateScript, readLocationScript, setLocationScript } from './scripts';
import { AddResult, LocationResult, PlatformId, Product, SearchResult } from './types';

/**
 * Hosts one long-lived WebView per platform. They sit behind the app's UI
 * (or are shown full-screen on the Accounts tab so the user can log in).
 * Because they keep the site's own cookies, items added here land in the
 * user's real Blinkit / Zepto cart.
 */

interface BrowserApi {
  search(pid: PlatformId, query: string): Promise<SearchResult>;
  /** Drops every search that is queued or running (a new comparison is starting). */
  cancelSearches(): void;
  setCartCount(pid: PlatformId, query: string, productId: string, count: number): Promise<AddResult>;
  /** Types a pincode/area into the site's location picker and picks the first match. */
  setLocation(pid: PlatformId, query: string): Promise<LocationResult>;
  /** Reads the delivery address the site is currently using. */
  readLocation(pid: PlatformId): Promise<LocationResult>;
  /** Reads the address shown on whatever page the store is on now, without navigating. */
  peekLocation(pid: PlatformId): Promise<LocationResult>;
  goTo(pid: PlatformId, url: string): void;
  reload(pid: PlatformId): void;
}

const BrowserContext = createContext<BrowserApi | null>(null);

export function useBrowsers(): BrowserApi {
  const api = useContext(BrowserContext);
  if (!api) throw new Error('useBrowsers must be used inside <BrowserProvider>');
  return api;
}

// Make the WebView look like Safari so the sites serve their normal mobile pages.
const SAFARI_SUFFIX = 'Version/18.0 Mobile/15E148 Safari/604.1';

/** Desktop Safari, for stores whose desktop site we read (see PlatformConfig.site). */
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

/**
 * Lays desktop pages out at desktop width (then scaled to fit the phone), so the
 * page has the same structure the store adapters were built against.
 */
const DESKTOP_VIEWPORT = `(function () {
  function fix() {
    var m = document.querySelector('meta[name="viewport"]');
    if (!m) { m = document.createElement('meta'); m.name = 'viewport'; (document.head || document.documentElement).appendChild(m); }
    if (m.content !== 'width=1200') m.content = 'width=1200';
  }
  fix();
  new MutationObserver(fix).observe(document.documentElement, { childList: true, subtree: true });
})(); true;`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Hosts that only exist to bounce you into a store's app (or the App Store). */
const APP_LINK_HOSTS = /(^|\.)(onelink\.me|app\.link|page\.link|adj\.st|adjust\.com|go\.link|appsflyer\.com|apps\.apple\.com|itunes\.apple\.com|smart\.link)$/i;

/**
 * Which navigations a store WebView may make. Web pages and the sites' own embedded
 * frames (about:srcdoc / about:blank) are fine; app links (bigbasket://, swiggy://,
 * intent://, App Store, deep-link redirectors) are silently dropped so we stay in the app.
 */
function allowLoad(req: { url: string; isTopFrame?: boolean }): boolean {
  const url = req.url || '';
  if (/^about:/i.test(url)) return true;
  if (!/^https?:/i.test(url)) return false;
  const host = (url.match(/^https?:\/\/([^/?#:]+)/i)?.[1] ?? '').toLowerCase();
  if (APP_LINK_HOSTS.test(host)) return false;
  return true;
}

/** Load a blank page (keeps cookies/login) so a store's page stops using memory. */
const BLANK_PAGE = `window.__pcStale = true; window.location.replace('about:blank'); true;`;

/**
 * How many stores may load search pages at the same time. Each store page is a
 * full website, and five at once can saturate a phone's CPU and memory.
 */
const MAX_PARALLEL_SEARCHES = 2;
let jobCounter = 0;
const newJobId = () => `job_${Date.now()}_${++jobCounter}`;

type Resolver = (msg: any) => void;

export function BrowserProvider({ children }: { children: React.ReactNode }) {
  const refs = useRef<Record<PlatformId, WebView<any> | null>>(allStores(() => null));
  const urls = useRef<Record<PlatformId, string>>(allStores(() => ''));
  const pending = useRef(new Map<string, Resolver>());
  const queues = useRef<Record<PlatformId, Promise<unknown>>>(allStores(() => Promise.resolve()));
  // Bumped by cancelSearches(); a search started under an older value gives up at its next check.
  const searchEpoch = useRef(0);
  // A tiny semaphore limiting parallel page loads across stores.
  const activeSearches = useRef(0);
  const waiting = useRef<(() => void)[]>([]);
  const acquire = useCallback(async () => {
    if (activeSearches.current < MAX_PARALLEL_SEARCHES) {
      activeSearches.current++;
      return;
    }
    await new Promise<void>((r) => waiting.current.push(r));
    activeSearches.current++;
  }, []);
  const release = useCallback(() => {
    activeSearches.current--;
    waiting.current.shift()?.();
  }, []);
  // Searches in a row where a store's page never answered. After two, the rest of that
  // store's queue fails fast instead of each item burning ~40 s and holding a search slot.
  const deadStreak = useRef<Record<PlatformId, number>>(allStores(() => 0));
  const deadAt = useRef<Record<PlatformId, number>>(allStores(() => 0));
  const cancelSearches = useCallback(() => {
    searchEpoch.current++;
    deadStreak.current = allStores(() => 0);
  }, []);

  /** Runs jobs for one platform one at a time, since each has a single WebView. */
  // Jobs waiting or running per store, the store shown on the Stores tab, and idle timers.
  const busyCount = useRef<Record<PlatformId, number>>(allStores(() => 0));
  const visibleRef = useRef<PlatformId | null>(null);
  const parkTimers = useRef<Partial<Record<PlatformId, ReturnType<typeof setTimeout>>>>({});

  /**
   * After a store has had no work for a few seconds (and isn't on screen), load a blank
   * page in its WebView. A full store website can use 100+ MB; with five of them iOS
   * starts killing the pages. The store's cookies/login are kept; the next job reloads it.
   */
  const scheduleParking = useCallback((pid: PlatformId) => {
    const t = parkTimers.current[pid];
    if (t) clearTimeout(t);
    parkTimers.current[pid] = setTimeout(() => {
      if (busyCount.current[pid] > 0 || visibleRef.current === pid) return;
      if (urls.current[pid] === 'about:blank') return;
      urls.current[pid] = 'about:blank';
      refs.current[pid]?.injectJavaScript(BLANK_PAGE);
    }, 5000);
  }, []);

  const enqueue = useCallback(
    <T,>(pid: PlatformId, fn: () => Promise<T>): Promise<T> => {
      busyCount.current[pid]++;
      const t = parkTimers.current[pid];
      if (t) clearTimeout(t);
      const run = () =>
        fn().finally(() => {
          busyCount.current[pid]--;
          if (busyCount.current[pid] === 0) scheduleParking(pid);
        });
      const next = queues.current[pid].then(run, run);
      queues.current[pid] = next.catch(() => undefined);
      return next;
    },
    [scheduleParking],
  );

  const inject = useCallback((pid: PlatformId, script: (jobId: string) => string, timeoutMs: number) => {
    return new Promise<any>((resolve) => {
      const jobId = newJobId();
      const timer = setTimeout(() => {
        pending.current.delete(jobId);
        resolve(null);
      }, timeoutMs);
      pending.current.set(jobId, (msg) => {
        clearTimeout(timer);
        pending.current.delete(jobId);
        resolve(msg);
      });
      refs.current[pid]?.injectJavaScript(script(jobId));
    });
  }, []);

  const navigate = useCallback((pid: PlatformId, url: string) => {
    urls.current[pid] = url;
    refs.current[pid]?.injectJavaScript(navigateScript(url));
  }, []);

  const search = useCallback(
    (pid: PlatformId, query: string) => {
      const epoch = searchEpoch.current;
      const cancelled = () => epoch !== searchEpoch.current;
      return enqueue(pid, async (): Promise<SearchResult> => {
        if (cancelled()) return { products: [], cancelled: true };
        // Give up early only for a minute, so "Try again" later really tries again.
        if (deadStreak.current[pid] >= 2 && Date.now() - deadAt.current[pid] < 60000) {
          return { products: [], error: `${PLATFORMS[pid].name} isn't responding right now. Tap Try again in a bit.` };
        }
        await acquire();
        try {
          if (cancelled()) return { products: [], cancelled: true };
          const r = await runSearch(pid, query, cancelled);
          if (!r.cancelled) {
            deadStreak.current[pid] = r.neverLoaded ? deadStreak.current[pid] + 1 : 0;
            if (r.neverLoaded) deadAt.current[pid] = Date.now();
          }
          return r;
        } finally {
          // The results are read; drop the page right away instead of keeping a full store
          // website alive while this store waits for its next turn. With five stores this
          // keeps at most two store pages in memory, so iOS stops killing them.
          if (visibleRef.current !== pid) {
            urls.current[pid] = 'about:blank';
            refs.current[pid]?.injectJavaScript(BLANK_PAGE);
          }
          release();
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enqueue, acquire, release],
  );

  const runSearch = async (
    pid: PlatformId,
    query: string,
    cancelled: () => boolean,
  ): Promise<SearchResult & { neverLoaded?: boolean }> => {
        let pageText = '';
        let diag = '';
        let everLoaded = false;
        // Up to two attempts: a page that never loads (or loads blank) gets one more try.
        for (let attempt = 1; attempt <= 2; attempt++) {
          navigate(pid, PLATFORMS[pid].searchUrl(query));
          await sleep(attempt === 1 ? 1200 : 2500);
          const start = Date.now();
          let latest: Product[] = [];
          let warning: string | undefined;
          let loaded = false;
          // A page that hasn't answered at all gets 15 s; one that is answering gets 22 s to show products.
          while (Date.now() - start < (loaded ? 22000 : 15000)) {
            if (cancelled()) return { products: [], cancelled: true };
            // The page script waits (inside the page) until the product list stops changing,
            // then reads it once, so one call usually returns the final list.
            const r = await inject(pid, (id) => extractScript(pid, id), 12000);
            if (r && !r.stale) {
              loaded = true;
              if (r.error) return { products: [], error: r.error };
              if (r.needsLocation) {
                return {
                  products: [],
                  error: PLATFORMS[pid].autoLocation
                    ? 'Delivery address not set. Tap "Deliver to" at the top and set it.'
                    : `Set your ${PLATFORMS[pid].name} delivery location once on the Stores tab.`,
                };
              }
              if (r.locationWarning) warning = 'Address not set: prices may not match your area.';
              latest = r.items ?? [];
              if (r.pageText) pageText = r.pageText;
              if (r.diag) diag = r.diag;
              if (latest.length > 0) return { products: latest, warning };
              if (r.noResults) return { products: [], warning };
            }
            await sleep(700);
          }
          if (latest.length) return { products: latest, warning };
          if (loaded) everLoaded = true;
          console.warn(
            `[search] ${pid} "${query}" attempt ${attempt}: ${loaded ? 'page loaded but no products' : 'page never loaded'}` +
              (pageText ? ` | page shows: ${pageText.slice(0, 160)}` : '') +
              (diag ? ` | markers: ${diag}` : ''),
          );
        }
        const shows = pageText.replace(/\s+/g, ' ').trim().slice(0, 90);
        return {
          products: [],
          neverLoaded: !everLoaded,
          error: shows ? `${PLATFORMS[pid].name} showed no products (page says: "${shows}…")` : `${PLATFORMS[pid].name} didn't load in time`,
        };
  };

  const setCartCount = useCallback(
    (pid: PlatformId, query: string, productId: string, count: number) =>
      enqueue(pid, async (): Promise<AddResult> => {
        const url = PLATFORMS[pid].searchUrl(query);
        if (urls.current[pid] !== url) {
          navigate(pid, url);
          await sleep(1500);
        }
        const start = Date.now();
        while (Date.now() - start < 25000) {
          const r = await inject(pid, (id) => addScript(pid, id, productId, count), 16000);
          if (r && !r.stale) return { ok: !!r.ok, count: r.count, error: r.error };
          await sleep(800);
        }
        return { ok: false, error: 'Timed out' };
      }),
    [enqueue, inject, navigate],
  );

  /** Injects a script on the site's home page, retrying until the new page has loaded. */
  const onHomePage = useCallback(
    async (pid: PlatformId, script: (jobId: string) => string, timeoutMs: number) => {
      navigate(pid, PLATFORMS[pid].homeUrl);
      await sleep(2000);
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const r = await inject(pid, script, timeoutMs);
        if (r && !r.stale) return r;
        await sleep(800);
      }
      return null;
    },
    [inject, navigate],
  );

  const setLocation = useCallback(
    (pid: PlatformId, query: string) =>
      enqueue(pid, async (): Promise<LocationResult> => {
        // Some stores only accept a location typed by a person; the user sets those on the Stores tab.
        if (!PLATFORMS[pid].autoLocation) return { ok: false, manual: true, error: 'Set on the Stores tab' };
        // The script gives up on its own after ~45s and says which step failed;
        // this outer limit only catches a page that never runs the script.
        const r = await onHomePage(pid, (id) => setLocationScript(pid, id, query), 60000);
        if (!r) return { ok: false, error: 'The site did not respond. Open the Stores tab to check it loads.' };
        return { ok: !!r.ok, address: r.address, error: r.error, notServiceable: !!r.notServiceable };
      }),
    [enqueue, onHomePage],
  );

  const readLocation = useCallback(
    (pid: PlatformId) =>
      enqueue(pid, async (): Promise<LocationResult> => {
        const r = await onHomePage(pid, (id) => readLocationScript(pid, id), 15000);
        if (!r) return { ok: false, error: 'Timed out' };
        return { ok: !!r.address, address: r.address, notServiceable: !!r.notServiceable };
      }),
    [enqueue, onHomePage],
  );

  const peekLocation = useCallback(
    (pid: PlatformId) =>
      enqueue(pid, async (): Promise<LocationResult> => {
        const r = await inject(pid, (id) => readLocationScript(pid, id), 9000);
        if (!r || r.stale) return { ok: false, manual: !PLATFORMS[pid].autoLocation };
        return { ok: !!r.address, address: r.address, manual: !PLATFORMS[pid].autoLocation };
      }),
    [enqueue, inject],
  );

  const goTo = useCallback((pid: PlatformId, url: string) => navigate(pid, url), [navigate]);
  const reload = useCallback((pid: PlatformId) => refs.current[pid]?.reload(), []);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg && msg.jobId) pending.current.get(msg.jobId)?.(msg);
    } catch {
      // Messages from the site itself; ignore.
    }
  }, []);

  const api = useMemo(
    () => ({ search, cancelSearches, setCartCount, setLocation, readLocation, peekLocation, goTo, reload }),
    [search, cancelSearches, setCartCount, setLocation, readLocation, peekLocation, goTo, reload],
  );
  const layer = useMemo(() => ({ refs, urls, onMessage, visibleRef }), [onMessage]);

  return (
    <BrowserContext.Provider value={api}>
      <LayerContext.Provider value={layer}>{children}</LayerContext.Provider>
    </BrowserContext.Provider>
  );
}

interface LayerInternals {
  refs: React.MutableRefObject<Record<PlatformId, WebView<any> | null>>;
  urls: React.MutableRefObject<Record<PlatformId, string>>;
  onMessage: (e: WebViewMessageEvent) => void;
  visibleRef: React.MutableRefObject<PlatformId | null>;
}

const LayerContext = createContext<LayerInternals | null>(null);

/**
 * The WebViews themselves. Render this once, filling the area where a site
 * should appear when it is shown. It must stay mounted the whole time the app
 * runs, or the site pages (and pending jobs) are lost.
 */
export function BrowserLayer({
  visible,
  enabled,
  onNavigate,
}: {
  visible: PlatformId | null;
  /** Stores switched on; only these get a WebView (each one costs memory and data). */
  enabled: PlatformId[];
  /** Called with each page the store WebView finishes loading (used to spot order confirmations). */
  onNavigate?: (pid: PlatformId, url: string, title: string) => void;
}) {
  const layer = useContext(LayerContext);
  if (!layer) throw new Error('BrowserLayer must be inside <BrowserProvider>');
  const { refs, urls, onMessage, visibleRef } = layer;
  // Links we cancelled (a tap) and are loading ourselves, so the reload isn't cancelled again.
  const reissued = useRef<Partial<Record<PlatformId, { url: string; at: number }>>>({});
  // When a parked (blank) store is opened on the Stores tab, load its home page again.
  useEffect(() => {
    visibleRef.current = visible;
    if (visible && (!urls.current[visible] || urls.current[visible] === 'about:blank')) {
      urls.current[visible] = PLATFORMS[visible].homeUrl;
      refs.current[visible]?.injectJavaScript(`window.location.href = ${JSON.stringify(PLATFORMS[visible].homeUrl)}; true;`);
    }
  }, [visible, refs, urls, visibleRef]);
  return (
    <View style={StyleSheet.absoluteFill}>
      {PLATFORM_IDS.filter((pid) => enabled.includes(pid)).map((pid) => {
        const shown = visible === pid;
        return (
          <View
            key={pid}
            pointerEvents={shown ? 'auto' : 'none'}
            // Keep every WebView fully opaque and just stack the app's screens on top.
            // A transparent (opacity 0) WebView can be treated as hidden by iOS, which
            // pauses its rendering and makes the store pages load slowly or not at all.
            style={[StyleSheet.absoluteFill, { zIndex: shown ? 2 : 1 }]}
          >
            <WebView
              ref={(r) => {
                refs.current[pid] = r;
              }}
              source={{ uri: PLATFORMS[pid].homeUrl }}
              userAgent={PLATFORMS[pid].site === 'desktop' ? DESKTOP_UA : undefined}
              applicationNameForUserAgent={PLATFORMS[pid].site === 'desktop' ? undefined : SAFARI_SUFFIX}
              injectedJavaScriptBeforeContentLoaded={PLATFORMS[pid].site === 'desktop' ? DESKTOP_VIEWPORT : undefined}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              javaScriptEnabled
              domStorageEnabled
              setSupportMultipleWindows={false}
              allowsBackForwardNavigationGestures
              // Accept every URL here and decide in onShouldStartLoadWithRequest. A URL that
              // fails originWhitelist is handed to iOS (Linking.openURL), which is what opened
              // the BigBasket / Amazon / Swiggy apps when their pages tried an app link.
              originWhitelist={['*']}
              onShouldStartLoadWithRequest={(req) => {
                if (!allowLoad(req)) return false;
                // iOS opens a store's own app (a "universal link") when you TAP a link to
                // amazon.in / swiggy.com etc. inside a web view. A page change started by the
                // app instead of a tap never does that, so cancel the tap and load the same
                // page ourselves.
                const again = reissued.current[pid];
                if (again && again.url === req.url && Date.now() - again.at < 3000) {
                  // Our own reload of a tapped link: let it through (never loop).
                  reissued.current[pid] = undefined;
                  return true;
                }
                if (req.navigationType === 'click' && req.isTopFrame !== false && /^https?:/i.test(req.url)) {
                  // iOS holds its main thread while it waits for this answer, so never call back
                  // into the web view from inside this handler (that froze the whole app).
                  // Answer first, then load the page a moment later.
                  const url = req.url;
                  reissued.current[pid] = { url, at: Date.now() };
                  setTimeout(() => {
                    refs.current[pid]?.injectJavaScript(`window.location.assign(${JSON.stringify(url)}); true;`);
                  }, 50);
                  return false;
                }
                return true;
              }}
              onNavigationStateChange={(nav) => {
                if (nav.loading) return;
                urls.current[pid] = nav.url;
                onNavigate?.(pid, nav.url, nav.title ?? '');
              }}
              onMessage={onMessage}
              // iOS kills a WebView's page process when memory runs low, leaving it blank;
              // reload it so the store keeps working.
              onContentProcessDidTerminate={() => {
                console.warn(`[webview] ${pid} page process was terminated by iOS; reloading`);
                refs.current[pid]?.reload();
              }}
            />
          </View>
        );
      })}
    </View>
  );
}
