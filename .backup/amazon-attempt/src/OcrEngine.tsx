import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

/**
 * Free, on-device text recognition (OCR) for photos of shopping lists.
 *
 * Runs Tesseract.js inside a tiny hidden WebView, so it works in Expo Go with
 * no native module, no API key and no account. The photo never leaves the
 * phone; only the Tesseract code (~300 KB) and the English language data
 * (~4 MB, cached after the first use) are downloaded from public CDNs.
 *
 * Good at printed lists and screenshots; weak at messy handwriting.
 */

export interface OcrResult {
  text: string;
  /** 0-100, Tesseract's mean word confidence. */
  confidence: number;
}

interface OcrApi {
  recognize(base64Jpeg: string, onProgress?: (fraction: number, status: string) => void): Promise<OcrResult>;
}

const OcrContext = createContext<OcrApi | null>(null);

export function useOcr(): OcrApi {
  const api = useContext(OcrContext);
  if (!api) throw new Error('useOcr must be used inside <OcrProvider>');
  return api;
}

// Pinned version, loaded from jsDelivr. Tesseract fetches its worker, WASM core
// and language data from CDNs on first use and caches the language data.
const HTML = `<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"></script>
</head><body><script>
  var workerPromise = null;
  var current = null;
  function post(o) { window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  function getWorker() {
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker('eng', 1, {
        logger: function (m) { if (current) post({ id: current, progress: m.progress || 0, status: m.status || '' }); }
      }).catch(function (e) { workerPromise = null; throw e; });
    }
    return workerPromise;
  }
  window.__ocr = function (id, dataUrl) {
    current = id;
    if (typeof Tesseract === 'undefined') { post({ id: id, error: 'Could not download the text reader. Check your internet connection.' }); return; }
    getWorker()
      .then(function (w) { return w.recognize(dataUrl); })
      .then(function (r) { post({ id: id, text: r.data.text || '', confidence: r.data.confidence || 0 }); })
      .catch(function (e) { post({ id: id, error: String((e && e.message) || e) }); })
      .then(function () { current = null; });
  };
  post({ ready: true });
</script></body></html>`;

type Pending = {
  resolve: (r: OcrResult) => void;
  reject: (e: Error) => void;
  onProgress?: (fraction: number, status: string) => void;
  timer: ReturnType<typeof setTimeout>;
};

export function OcrProvider({ children }: { children: React.ReactNode }) {
  const ref = useRef<WebView<any> | null>(null);
  const pending = useRef(new Map<string, Pending>());
  const ready = useRef<Promise<void>>(null as unknown as Promise<void>);
  const markReady = useRef<() => void>(() => undefined);
  if (!ready.current) {
    ready.current = new Promise<void>((r) => {
      markReady.current = r;
    });
  }
  const counter = useRef(0);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let m: any;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.ready) {
      markReady.current();
      return;
    }
    const p = m.id && pending.current.get(m.id);
    if (!p) return;
    if (typeof m.progress === 'number' && m.text === undefined && !m.error) {
      p.onProgress?.(m.progress, m.status);
      return;
    }
    clearTimeout(p.timer);
    pending.current.delete(m.id);
    if (m.error) p.reject(new Error(m.error));
    else p.resolve({ text: m.text ?? '', confidence: m.confidence ?? 0 });
  }, []);

  const recognize = useCallback(async (base64Jpeg: string, onProgress?: (f: number, s: string) => void) => {
    // First use may need to download ~4 MB of language data, so allow plenty of time.
    await Promise.race([
      ready.current,
      new Promise<void>((_, rej) => setTimeout(() => rej(new Error('The text reader did not start. Check your internet connection.')), 30000)),
    ]);
    const id = `ocr_${Date.now()}_${++counter.current}`;
    return new Promise<OcrResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.current.delete(id);
        reject(new Error('Reading the photo took too long. Try a closer, brighter photo.'));
      }, 120000);
      pending.current.set(id, { resolve, reject, onProgress, timer });
      ref.current?.injectJavaScript(
        `window.__ocr(${JSON.stringify(id)}, ${JSON.stringify('data:image/jpeg;base64,' + base64Jpeg)}); true;`,
      );
    });
  }, []);

  const api = useMemo(() => ({ recognize }), [recognize]);

  return (
    <OcrContext.Provider value={api}>
      {children}
      {/* Tiny and covered by the app's screens; kept rendered so iOS doesn't pause it. */}
      <View pointerEvents="none" style={s.host}>
        <WebView
          ref={ref}
          source={{ html: HTML, baseUrl: 'https://localhost/' }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          onMessage={onMessage}
        />
      </View>
    </OcrContext.Provider>
  );
}

const s = StyleSheet.create({
  host: { position: 'absolute', left: 0, bottom: 0, width: 2, height: 2, zIndex: -1, overflow: 'hidden' },
});
