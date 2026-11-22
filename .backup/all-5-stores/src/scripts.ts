/**
 * JavaScript injected into the store websites (Blinkit and Zepto mobile sites;
 * Instamart, BigBasket and Amazon Fresh desktop sites) running inside hidden
 * WebViews. Everything here reads the visible page text rather than
 * CSS class names, because both sites use generated class names that change
 * with every deploy.
 *
 * Every script posts exactly one message back: { jobId, ... }.
 * If the page is the one we were navigating away from (window.__pcStale),
 * it posts { stale: true } so the app can retry once the new page has loaded.
 *
 * NOTE: these use String.raw so regex backslashes survive the template literal.
 */
import { PlatformId } from './types';

const HELPERS = String.raw`
  function post(o) { o.jobId = JOB; window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function visible(e) {
    if (!e) return false;
    if (e.offsetParent !== null) return true;
    // offsetParent is null for position:fixed elements (common in modals), so fall back to the box size.
    var r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function linesOf(el) {
    return (el.innerText || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  }
  // Instamart, BigBasket and Amazon load their desktop sites; their cards are read with
  // textContent (works even while the page isn't being painted) and stable attributes.
  var NEW_STORE = PLATFORM === 'instamart' || PLATFORM === 'bigbasket' || PLATFORM === 'amazon';
  var QTY = /^(\d+(\.\d+)?\s*x\s*)?\d+(\.\d+)?\s*(g|gm|gms|kg|ml|l|ltr|litre|liter|pc|pcs|piece|pieces|pack|packs|units?|dozen)\b|^\d+\s*pack\s*\(/i;
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function leafTexts(el) {
    if (!el) return [];
    return qsa('*', el).filter(function (e) {
      return e.childElementCount === 0 && e.tagName !== 'SCRIPT' && e.tagName !== 'STYLE';
    }).map(function (e) { return (e.textContent || '').replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  }
  function textOf(el) { return el ? ((el.innerText || el.textContent || '') + '') : ''; }
  function money(s) { return parseFloat(String(s).replace(/[₹,\s]/g, '')); }
  function instamartNameQty(card) {
    // Guest pages wrap the name in "item-collection-card-full"; logged-in pages may not.
    var inner = card.querySelector('[data-testid="item-collection-card-full"]') || card;
    var name = leafTexts(inner).find(function (l) {
      return !/^\d+\s*MINS?$/i.test(l) && !/^(ad|sponsored|bestseller|new)$/i.test(l) && !/off$/i.test(l) &&
        !QTY.test(l) && !/^₹?\s*[\d,.]+$/.test(l) && l.length > 2;
    }) || '';
    var qty = leafTexts(card).find(function (l) { return QTY.test(l); }) || '';
    return { name: name, qty: qty };
  }
  function allCards() {
    if (PLATFORM === 'zepto') return qsa('a[data-testid="product-card"]');
    if (PLATFORM === 'instamart') {
      // The full card is the largest ancestor that still holds just one product. Start from the
      // "+" buttons (present on every layout) when the guest-page card marker isn't there.
      var anchors = qsa('[data-testid="item-collection-card-full"]');
      if (!anchors.length) {
        return qsa('[data-testid="buttonpair-add"], [aria-label="Add item to cart"]').map(function (b) {
          var c = b;
          for (var i = 0; i < 8; i++) {
            var p = c.parentElement;
            if (!p || p.querySelectorAll('[data-testid="buttonpair-add"], [aria-label="Add item to cart"]').length > 1) break;
            c = p;
          }
          return c;
        });
      }
      return anchors.map(function (x) {
        var c = x;
        for (var i = 0; i < 5; i++) {
          var p = c.parentElement;
          if (!p || p.querySelectorAll('[data-testid="item-collection-card-full"]').length > 1) break;
          c = p;
        }
        return c;
      });
    }
    if (PLATFORM === 'bigbasket') {
      return qsa('li').filter(function (li) { return li.querySelector('a[href*="/pd/"]') && li.querySelector('button'); });
    }
    if (PLATFORM === 'amazon') {
      return qsa('[data-component-type="s-search-result"][data-asin]').filter(function (c) { return c.getAttribute('data-asin'); });
    }
    return qsa('div[role="button"][id]').filter(function (c) {
      return /^\d+$/.test(c.id) && /₹/.test(c.innerText || '');
    });
  }
  function cardId(card) {
    if (PLATFORM === 'zepto') { var h = card.getAttribute('href') || ''; return h.split('/pvid/')[1] || ''; }
    if (PLATFORM === 'bigbasket') {
      var a = card.querySelector('a[href*="/pd/"]');
      var m = a ? (a.getAttribute('href') || '').match(/\/pd\/(\d+)/) : null;
      return m ? m[1] : '';
    }
    if (PLATFORM === 'amazon') return card.getAttribute('data-asin') || '';
    if (PLATFORM === 'instamart') {
      // No product id on the card: name + pack size identifies it.
      var nq = instamartNameQty(card);
      return nq.name ? (nq.name + '|' + nq.qty).toLowerCase() : '';
    }
    return card.id;
  }
  function findCard(id) {
    if (PLATFORM === 'zepto') return document.querySelector('a[data-testid="product-card"][href*="/pvid/' + id + '"]');
    if (NEW_STORE) return allCards().find(function (c) { return cardId(c) === id; }) || null;
    return document.getElementById(id);
  }
  function isOutOfStock(card) {
    return /out of stock|sold out|notify me|currently unavailable/i.test(textOf(card)) ||
      card.querySelector('[data-is-out-of-stock="true"]') != null;
  }
  /** How many of this product are in the cart; -1 when the store doesn't show it on the card. */
  function cartCount(card) {
    if (PLATFORM === 'instamart') return -1;
    if (PLATFORM === 'amazon') {
      var m = textOf(card).match(/(\d+)\s+in cart/i);
      return m ? parseInt(m[1], 10) : 0;
    }
    if (PLATFORM === 'bigbasket') {
      var n = leafTexts(card).filter(function (l) { return /^\d+$/.test(l); });
      return n.length ? parseInt(n[0], 10) : 0;
    }
    var ls = linesOf(card);
    if (ls.some(function (l) { return /^add$/i.test(l); })) return 0;
    var n2 = ls.filter(function (l) { return /^\d+$/.test(l); });
    return n2.length ? parseInt(n2[0], 10) : 0;
  }
  /** Instamart's cart bar: aria-label "Cart item quantity is N". */
  function instamartCartTotal() {
    var hud = document.querySelector('[data-testid="bottom-cart-hud"]');
    var m = hud ? (hud.getAttribute('aria-label') || '').match(/quantity is (\d+)/i) : null;
    return m ? parseInt(m[1], 10) : 0;
  }
  function needsLocation() {
    if (PLATFORM === 'amazon') {
      var loc = document.querySelector('#glow-ingress-line2') || document.querySelector('#glow-ingress-single-line');
      return !!loc && /update location|select your address|select a location/i.test(loc.textContent || '') && !allCards().length;
    }
    if (PLATFORM === 'bigbasket') {
      // Mobile BigBasket shows no products until a location is chosen.
      return !allCards().length && /select location to view product availability/i.test(document.body ? textOf(document.body).slice(0, 3000) : '');
    }
    if (PLATFORM !== 'blinkit') return false;
    var t = document.body ? textOf(document.body) : '';
    return /provide your delivery location/i.test(t);
  }
  /** A store-specific blocker the user has to deal with on the Stores tab (login wall etc.). */
  function storeBlock() {
    var t = document.body ? textOf(document.body).slice(0, 3000) : '';
    if (PLATFORM === 'instamart' && !allCards().length && /log in to continue|login to continue/i.test(t)) return 'Instamart asks you to log in. Open the Stores tab, choose Instamart and log in once.';
    if (PLATFORM === 'amazon' && /enter the characters you see|type the characters|not a robot/i.test(t)) return 'Amazon wants a security check. Open the Stores tab, choose Amazon Fresh and complete it once.';
    return '';
  }
`;

function wrap(platform: PlatformId, jobId: string, body: string): string {
  return `(function(){
    var PLATFORM = ${JSON.stringify(platform)};
    var JOB = ${JSON.stringify(jobId)};
    ${HELPERS}
    if (window.__pcStale) { post({ stale: true }); return; }
    (async function(){ ${body} })().catch(function (e) { post({ error: String(e && e.message || e) }); });
  })(); true;`;
}

const EXTRACT_BODY = String.raw`
  function junk(l) {
    return /^₹/.test(l) || /^\d+\s*MINS?$/i.test(l) || /%\s*off/i.test(l) || /^add$/i.test(l) ||
      /^[\d.,+\-]+$/.test(l) || /^(out of stock|notify me|sold out)$/i.test(l) || /^save\s*₹/i.test(l) ||
      /^\(?[\d.]+k?\)?$/i.test(l) || /^(bestseller|best seller|new|ad|sponsored|buy again|trending|featured)$/i.test(l) ||
      // Discount labels: "OFF", "₹3 OFF", "Save ₹3", "Get ₹5 off", "Saved ₹10"
      /^off$/i.test(l) || /\boff$/i.test(l) || /^(save|saved|get|flat)\b/i.test(l) ||
      // Ratings: "4.9 (516.0k)", "4.9"
      /^\d(\.\d)?\s*\(?[\d.,]+k?\)?$/i.test(l) || l.length < 3;
  }
  /**
   * Selling price and MRP. A "₹" amount that is a discount ("₹3" followed by
   * "OFF", or "Save ₹3") is not a price. Of the first two real prices, the lower
   * is the selling price and the higher is the MRP.
   */
  function pricesOf(lines) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (!/^₹\s*[\d,]+(\.\d+)?$/.test(l)) continue;
      var next = lines[i + 1] || '';
      var prev = lines[i - 1] || '';
      if (/^(off|discount|saved?)\b/i.test(next) || /^(save|saved|get|flat|extra)$/i.test(prev)) continue;
      out.push(money(l));
      if (out.length === 2) break;
    }
    if (!out.length) return null;
    var a = out[0], b = out.length > 1 ? out[1] : out[0];
    return { price: Math.min(a, b), mrp: Math.max(a, b) };
  }
  function bestImage(card) {
    var imgs = qsa('img', card);
    imgs.sort(function (a, b) { return (b.width * b.height) - (a.width * a.height); });
    var img = card.querySelector('img.s-image') || imgs[0];
    var src = img ? (img.currentSrc || img.src || img.getAttribute('data-src') || '') : '';
    return /^https?:/.test(src) ? src : '';
  }
  function parseInstamart(card) {
    var nq = instamartNameQty(card);
    if (!nq.name) return null;
    var leaves = leafTexts(card);
    var qi = leaves.indexOf(nq.qty);
    // Prices are bare numbers after the pack size (the ₹ sign is an image); "₹5 OFF" etc. don't match.
    var nums = leaves.slice(qi >= 0 ? qi + 1 : 0).filter(function (l) { return /^₹?\s*[\d,]+(\.\d+)?$/.test(l); }).map(money);
    if (!nums.length) return null;
    var a = nums[0], b = nums.length > 1 ? nums[1] : nums[0];
    var oos = isOutOfStock(card);
    return {
      id: cardId(card), name: nq.name, qty: nq.qty, price: Math.min(a, b), mrp: Math.max(a, b),
      image: bestImage(card), available: !oos, inCart: false,
      ad: leaves.some(function (l) { return /^(ad|sponsored)$/i.test(l); }), rating: 0, ratingCount: 0
    };
  }
  function parseBigbasket(card) {
    var leaves = leafTexts(card);
    // The card has an outer <h3> wrapping everything and an inner <h3> with just the product name.
    var h3 = qsa('h3', card).find(function (h) { return h.childElementCount === 0; });
    var title = h3 ? (h3.textContent || '').replace(/\s+/g, ' ').trim() : '';
    if (!title) {
      // Mobile layout: one <h3> holding brand, "10 mins" and the name.
      var parts = leafTexts(card.querySelector('h3')).filter(function (l) {
        return !/mins?$/i.test(l) && !/^[\d.]+$/.test(l) && !/ratings?$/i.test(l) && !QTY.test(l) && !/^₹/.test(l);
      });
      if (!parts.length) return null;
      var leavesM = leafTexts(card);
      var pricesM = pricesOf(leavesM);
      if (!pricesM) return null;
      var rcM = leavesM.map(function (l) { return l.match(/^([\d,]+)\s+Ratings?$/i); }).find(Boolean);
      var rtM = leavesM.find(function (l) { return /^\d\.\d$/.test(l); });
      var oosM = isOutOfStock(card);
      return {
        id: cardId(card), name: parts.join(' '), qty: leavesM.find(function (l) { return QTY.test(l); }) || '',
        price: pricesM.price, mrp: pricesM.mrp, image: bestImage(card), available: !oosM,
        inCart: !oosM && cartCount(card) > 0, ad: leavesM.some(function (l) { return /^(ad|sponsored)$/i.test(l); }),
        rating: rtM ? parseFloat(rtM) : 0, ratingCount: rcM ? parseInt(rcM[1].replace(/,/g, ''), 10) : 0
      };
    }
    var brandEl = card.querySelector('[class*="BrandName"]');
    var brandTxt = brandEl ? (brandEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
    // Brand: the nearest short label before the title. (Some cards also carry a hidden
    // accessibility label with the whole card text, which must be skipped.)
    var ti = leaves.indexOf(title);
    var brand = brandTxt.length <= 40 ? brandTxt : '';
    for (var bi = ti - 1; !brand && bi >= 0 && bi >= ti - 4; bi--) {
      var cand = leaves[bi];
      if (cand.length <= 40 && cand.indexOf(title) < 0 && !/mins?$|^\d|^₹|ratings?$/i.test(cand)) { brand = cand; break; }
    }
    var prices = pricesOf(leaves);
    if (!prices) return null;
    var rc = leaves.map(function (l) { return l.match(/^([\d,]+)\s+Ratings?$/i); }).find(Boolean);
    var rt = leaves.find(function (l) { return /^\d\.\d$/.test(l); });
    var oos = isOutOfStock(card);
    return {
      id: cardId(card), name: (brand ? brand + ' ' : '') + title,
      qty: leaves.find(function (l) { return QTY.test(l); }) || '',
      price: prices.price, mrp: prices.mrp, image: bestImage(card), available: !oos,
      inCart: !oos && cartCount(card) > 0,
      ad: leaves.some(function (l) { return /^(ad|sponsored)$/i.test(l); }),
      rating: rt ? parseFloat(rt) : 0, ratingCount: rc ? parseInt(rc[1].replace(/,/g, ''), 10) : 0
    };
  }
  function parseAmazon(card) {
    var t = card.querySelector('[data-cy="title-recipe"]') || card.querySelector('h2');
    var name = leafTexts(t).filter(function (l) { return !/^sponsored$/i.test(l); }).join(' ').replace(/\s+/g, ' ').trim();
    if (!name) return null;
    var pe = card.querySelector('[data-cy="price-recipe"] .a-price:not(.a-text-price) .a-offscreen') ||
      card.querySelector('.a-price:not(.a-text-price) .a-offscreen');
    if (!pe) return null;
    var price = money(pe.textContent || '');
    var me = card.querySelector('.a-price[data-a-strike="true"] .a-offscreen');
    var mrp = me ? money(me.textContent || '') : price;
    var size = name.match(/(\d+(?:\.\d+)?\s?(?:kg|kgs|grams?|g|gm|gms|ml|l|ltr|litres?|liters?|pcs?|pieces?|pack)\b(?:\s?x\s?\d+)?)/i);
    var ratingEl = card.querySelector('.a-icon-alt');
    var countEl = qsa('[aria-label]', card).map(function (e) { return (e.getAttribute('aria-label') || '').match(/^([\d,]+)\s+ratings?$/i); }).find(Boolean);
    var countTxt = !countEl ? (textOf(card).match(/\(([\d.]+)\s*([kK]?)\)/) || null) : null;
    var ratingCount = countEl ? parseInt(countEl[1].replace(/,/g, ''), 10)
      : countTxt ? Math.round(parseFloat(countTxt[1]) * (countTxt[2] ? 1000 : 1)) : 0;
    var oos = isOutOfStock(card);
    return {
      id: cardId(card), name: name, qty: size ? size[1] : '', price: price, mrp: Math.max(mrp, price),
      image: bestImage(card), available: !oos && price > 0, inCart: !oos && cartCount(card) > 0,
      ad: !!card.querySelector('.puis-sponsored-label-text, [aria-label="Sponsored"]'),
      rating: ratingEl ? parseFloat(ratingEl.textContent || '') || 0 : 0, ratingCount: ratingCount
    };
  }
  function parse(card) {
    if (PLATFORM === 'instamart') return parseInstamart(card);
    if (PLATFORM === 'bigbasket') return parseBigbasket(card);
    if (PLATFORM === 'amazon') return parseAmazon(card);
    var lines = linesOf(card);
    var prices = pricesOf(lines);
    if (!prices) return null;
    var nameIdx = -1;
    for (var i = 0; i < lines.length; i++) { if (!junk(lines[i]) && !QTY.test(lines[i])) { nameIdx = i; break; } }
    if (nameIdx < 0) return null;
    var qty = '';
    for (var j = nameIdx + 1; j < lines.length; j++) { if (QTY.test(lines[j])) { qty = lines[j]; break; } }
    if (!qty) for (var k = 0; k < nameIdx; k++) { if (QTY.test(lines[k])) { qty = lines[k]; break; } }
    var imgs = Array.prototype.slice.call(card.querySelectorAll('img'));
    imgs.sort(function (a, b) { return (b.width * b.height) - (a.width * a.height); });
    var img = imgs[0];
    var src = img ? (img.currentSrc || img.src || img.getAttribute('data-src') || '') : '';
    var oos = isOutOfStock(card);
    // Sponsored listings and popularity (Zepto shows ratings like "4.9 (516.0k)").
    var ad = lines.some(function (l) { return /^(ad|sponsored|promoted)$/i.test(l); });
    var ratingCount = 0, rating = 0;
    for (var r = 0; r < lines.length; r++) {
      var m = lines[r].match(/^(\d(?:\.\d)?)\s*\(\s*([\d.,]+)\s*([kKlLmM]?)\s*\)$/);
      if (m) {
        var n = parseFloat(m[2].replace(/,/g, ''));
        var mult = /k/i.test(m[3]) ? 1e3 : /l/i.test(m[3]) ? 1e5 : /m/i.test(m[3]) ? 1e6 : 1;
        rating = parseFloat(m[1]);
        ratingCount = Math.round(n * mult);
        break;
      }
    }
    return {
      ad: ad, rating: rating, ratingCount: ratingCount,
      id: cardId(card), name: lines[nameIdx], qty: qty,
      price: prices.price, mrp: prices.mrp,
      image: /^https?:/.test(src) ? src : '', available: !oos, inCart: !oos && cartCount(card) > 0
    };
  }
  // Wait inside the page (cheap: only counts cards) until the product list stops growing,
  // then read it once. Much lighter than reading the whole page again and again.
  var NO_RESULTS = /no results|nothing here|couldn.t find|could not find|no products|did not match|0 results|no matches/i;
  var lastN = -1;
  for (var wi = 0; wi < 24; wi++) {
    if (storeBlock() || needsLocation()) break;
    var nNow = allCards().length;
    if (nNow > 0 && nNow === lastN) break;
    if (nNow === 0 && wi >= 4 && NO_RESULTS.test(document.body ? textOf(document.body).slice(0, 4000) : '')) break;
    lastN = nNow;
    await sleep(nNow > 0 ? 450 : 350);
  }
  var blocked = storeBlock();
  if (blocked) { post({ error: blocked }); return; }
  if (needsLocation()) { post({ needsLocation: true, items: [] }); return; }
  var out = [], seen = {};
  allCards().forEach(function (c) {
    var r = null; try { r = parse(c); } catch (e) {}
    if (r && r.id && !seen[r.id]) { seen[r.id] = 1; out.push(r); }
  });
  var body = document.body ? textOf(document.body) : '';
  var noResults = out.length === 0 && /no results|nothing here|couldn.t find|could not find|no products|did not match|0 results|no matches/i.test(body);
  var locationWarning = PLATFORM === 'zepto' && /select location/i.test(body.slice(0, 400));
  // When nothing was found, send a little of the page text so the app can say what the store showed.
  post({
    items: out.slice(0, 24), noResults: noResults, locationWarning: locationWarning,
    pageText: out.length ? '' : body.replace(/\s+/g, ' ').slice(0, 200),
    diag: out.length ? '' : Array.from(new Set(qsa('[data-testid]').slice(0, 600).map(function (e) { return e.getAttribute('data-testid'); }))).slice(0, 25).join(',')
  });
`;

export function extractScript(platform: PlatformId, jobId: string): string {
  return wrap(platform, jobId, EXTRACT_BODY);
}

const ADD_BODY = String.raw`
  function addBtn(card) {
    if (PLATFORM === 'instamart') return card.querySelector('[data-testid="buttonpair-add"]');
    if (PLATFORM === 'amazon') {
      return card.querySelector('input[name="submit.addToCart"], button[name="submit.addToCart"]') ||
        qsa('button, [role="button"]', card).find(function (b) { return /^add to cart$/i.test((b.textContent || '').trim()); }) || null;
    }
    var els = Array.prototype.slice.call(card.querySelectorAll('button,[role="button"],div,span'));
    var leaf = els.find(function (e) { return e.childElementCount === 0 && /^add$/i.test((e.textContent || '').trim()) && visible(e); });
    if (!leaf) return null;
    return leaf.closest('button,[role="button"]') || leaf;
  }
  function stepBtn(card, up) {
    if (PLATFORM === 'zepto') return card.querySelector('button[aria-label="' + (up ? 'Increase' : 'Decrease') + ' quantity"]');
    if (PLATFORM === 'amazon') {
      return qsa('button, [role="button"], input', card).find(function (b) {
        var l = (b.getAttribute('aria-label') || '') + ' ' + (b.value || '');
        return up ? /increase quantity/i.test(l) : /decrease quantity|delete|remove/i.test(l);
      }) || null;
    }
    if (PLATFORM === 'bigbasket') {
      // Buttons either side of the count: first = minus, last = plus.
      var num = qsa('*', card).find(function (e) { return e.childElementCount === 0 && /^\d+$/.test((e.textContent || '').trim()); });
      var grp = num && num.parentElement && num.parentElement.parentElement;
      var bb = grp ? qsa('button', grp) : [];
      return bb.length ? (up ? bb[bb.length - 1] : bb[0]) : null;
    }
    var bs = Array.prototype.slice.call(card.querySelectorAll('button')).filter(visible);
    if (bs.length < 2) return null;
    return up ? bs[bs.length - 1] : bs[0];
  }
  var blocked = storeBlock();
  if (blocked) { post({ ok: false, error: blocked }); return; }
  if (needsLocation()) { post({ ok: false, error: 'Set your delivery location for this store first (Stores tab)' }); return; }
  var card = null;
  for (var t = 0; t < 40 && !card; t++) { card = findCard(PRODUCT); if (!card) await sleep(250); }
  if (!card) { post({ ok: false, error: 'Product not found on the page' }); return; }
  if (isOutOfStock(card)) { post({ ok: false, error: 'Out of stock' }); return; }
  if (PLATFORM === 'instamart') {
    // Instamart's cards don't show a per-item count; use the cart bar's total and press "+" WANT times.
    if (WANT === 0) { post({ ok: false, error: 'Remove Instamart items in its cart (Stores tab)' }); return; }
    for (var k = 0; k < WANT; k++) {
      var before = instamartCartTotal();
      var b = addBtn(findCard(PRODUCT) || card);
      if (!b) { post({ ok: false, error: 'Add button not found' }); return; }
      b.click();
      var moved = false;
      for (var w2 = 0; w2 < 16; w2++) { await sleep(250); if (instamartCartTotal() !== before) { moved = true; break; } }
      if (!moved) {
        if (k > 0) { post({ ok: true, count: k, error: 'Store limit: added ' + k }); return; }
        post({ ok: false, error: 'Instamart did not respond. Are you logged in and is a location set?' }); return;
      }
    }
    post({ ok: true, count: WANT }); return;
  }
  if (PLATFORM === 'amazon' && WANT === 0 && cartCount(card) > 0) {
    // Amazon's search page stops at 1 ("Minimum quantity is 1"); the last one is removed in the cart.
    var down = stepBtn(card, false);
    for (var d = 0; d < 20 && down && cartCount(findCard(PRODUCT) || card) > 1; d++) {
      var before2 = cartCount(findCard(PRODUCT) || card);
      down.click();
      for (var w3 = 0; w3 < 36; w3++) { await sleep(250); if (cartCount(findCard(PRODUCT) || card) !== before2) break; }
      down = stepBtn(findCard(PRODUCT) || card, false);
    }
    post({ ok: false, count: cartCount(findCard(PRODUCT) || card), error: 'Remove the last one in Amazon\'s cart (Stores tab)' }); return;
  }
  for (var guard = 0; guard < 30; guard++) {
    card = findCard(PRODUCT) || card;
    var c = cartCount(card);
    if (c === WANT) { post({ ok: true, count: c }); return; }
    var btn = c === 0 ? addBtn(card) : stepBtn(card, c < WANT);
    if (!btn) { post({ ok: false, count: c, error: 'Add button not found' }); return; }
    btn.click();
    // The newer stores update the cart over the network first (Amazon can take ~6 s).
    for (var w = 0; w < (NEW_STORE ? 36 : 12); w++) { await sleep(250); if (cartCount(findCard(PRODUCT) || card) !== c) break; }
    var after = cartCount(findCard(PRODUCT) || card);
    if (after === c) {
      // Sites show a short toast such as "We only have 1 piece left" when you hit a limit.
      var toast = Array.prototype.slice.call(document.querySelectorAll('body *')).map(function (e) {
        return e.childElementCount === 0 ? (e.textContent || '').trim() : '';
      }).find(function (t) { return t.length < 100 && /only have|left at the moment|limit|maximum|max(imum)? quantity|can.t add/i.test(t); });
      if (c > 0 && c < WANT) { post({ ok: true, count: c, error: toast || ('Store limit: max ' + c + ' per order') }); return; }
      if (toast) { post({ ok: false, count: c, error: toast }); return; }
      post({ ok: false, count: c, error: 'The site did not respond. Are you logged in?' }); return;
    }
  }
  post({ ok: false, count: cartCount(card), error: 'Could not set quantity' });
`;

export function addScript(platform: PlatformId, jobId: string, productId: string, count: number): string {
  const body = `var PRODUCT = ${JSON.stringify(productId)}; var WANT = ${Math.max(0, Math.floor(count))};\n${ADD_BODY}`;
  return wrap(platform, jobId, body);
}

/**
 * Reads the delivery address the site is currently using, from its header.
 * Blinkit: styled-component class "LocationBar__Subtitle" (the prefix is stable).
 * Zepto: <h3 data-testid="user-address">.
 */
const READ_LOCATION_FN = String.raw`
  function currentAddress() {
    var el;
    if (PLATFORM === 'zepto') el = document.querySelector('[data-testid="user-address"]');
    else if (PLATFORM === 'amazon') el = document.querySelector('#glow-ingress-line2') || document.querySelector('#glow-ingress-single-line');
    else if (PLATFORM === 'instamart') {
      // The address bar's text, once loaded (its test ids contain "address").
      el = Array.prototype.slice.call(document.querySelectorAll('[data-testid*="address" i]')).find(function (e) {
        return ((e.textContent || '').trim().length > 2);
      });
    } else if (PLATFORM === 'bigbasket') {
      // Header menu button: "Select Location" until set, then the area/pincode. Other header menus
      // ("Shop by Category", the account menu) use the same kind of button, so skip those.
      var menus = Array.prototype.slice.call(document.querySelectorAll('button[id^="headlessui-menu-button"]')).filter(function (b) {
        return !/login|sign ?up|shop ?by|category|my account|account|basket/i.test(b.textContent || '');
      });
      el = menus.find(function (b) { return /\b\d{6}\b|select location|deliver/i.test(b.textContent || ''); }) || menus[0];
    } else el = document.querySelector('[class*="LocationBar__Subtitle"]');
    var t = el ? ((el.innerText || el.textContent || '') + '').replace(/\s+/g, ' ').trim() : '';
    t = t.replace(/^deliver(ing)? to\s*/i, '').replace(/[⌵▾▼]/g, '').trim();
    if (!t && (PLATFORM === 'bigbasket' || PLATFORM === 'instamart')) {
      // Mobile headers: no stable marker, but a set address shows a pincode near the top.
      var top = qsa('body *').filter(function (e) { return e.childElementCount === 0; }).slice(0, 120);
      var hit = top.map(function (e) { return (e.textContent || '').replace(/\s+/g, ' ').trim(); })
        .find(function (x) { return x.length < 90 && /\b\d{6}\b/.test(x); });
      t = hit || '';
    }
    if (!t || /^(select location|update location|select your address|select a location)$/i.test(t)) return '';
    return t;
  }
  function notServiceable() {
    var t = document.body ? document.body.innerText : '';
    return /not serviceable|don.t deliver|do not deliver|coming soon to your|currently unavailable in your area|we are not available/i.test(t);
  }
`;

export function readLocationScript(platform: PlatformId, jobId: string): string {
  return wrap(
    platform,
    jobId,
    `${READ_LOCATION_FN}
    for (var i = 0; i < 24 && !currentAddress() && !needsLocation(); i++) await sleep(250);
    post({ address: currentAddress(), notServiceable: notServiceable() });`,
  );
}

/**
 * Opens the site's location picker, types the pincode/area, and picks the
 * first suggestion. Posts back the address the site shows afterwards.
 */
const SET_LOCATION_BODY = String.raw`
  function typeInto(input, value) {
    input.focus();
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function findInput() {
    var ins = Array.prototype.slice.call(document.querySelectorAll('input')).filter(visible);
    if (PLATFORM === 'zepto') return ins.find(function (i) { return /search a new address|search.*(area|location|address)/i.test(i.placeholder || ''); });
    return ins.find(function (i) { return i.name === 'select-locality' || /delivery location/i.test(i.placeholder || ''); });
  }
  function openPicker() {
    if (PLATFORM === 'zepto') {
      var b = document.querySelector('button[aria-label="Select Location"]');
      if (!b) { var h = document.querySelector('[data-testid="user-address"]'); b = h && (h.closest('button,[role="button"]') || h); }
      if (b) b.click();
    } else {
      var c = document.querySelector('[class*="LocationBar__Container"]');
      if (c) c.click();
    }
  }
  function suggestions() {
    var sel = PLATFORM === 'zepto' ? '[data-testid="address-search-item"]' : '[class*="LocationSearchList__LocationListContainer"]';
    return Array.prototype.slice.call(document.querySelectorAll(sel)).filter(visible);
  }
  function clickText(re) {
    var el = Array.prototype.slice.call(document.querySelectorAll('body *')).find(function (e) {
      return e.childElementCount === 0 && re.test((e.textContent || '').trim()) && visible(e);
    });
    if (el) { (el.closest('button,[role="button"],a') || el).click(); return true; }
    return false;
  }
  function hasLocationControl() {
    if (PLATFORM === 'zepto') return !!(document.querySelector('button[aria-label="Select Location"]') || document.querySelector('[data-testid="user-address"]'));
    return !!document.querySelector('[class*="LocationBar__Container"]');
  }
  // Every step reports where it got to, so a failure says *which* step broke.
  var STAGE = 'waiting for the page to load';
  var DEADLINE = Date.now() + 45000;
  function fail(msg) { post({ ok: false, stage: STAGE, error: msg + ' (while ' + STAGE + ')' }); }

  // The header (with the location button) can take many seconds to render on a phone.
  var input = findInput();
  while (!input && !hasLocationControl() && Date.now() < DEADLINE - 25000) { await sleep(300); input = findInput(); }
  if (!input && !hasLocationControl()) { fail('The site did not finish loading'); return; }

  // On a fresh session Blinkit stacks pop-ups: an empty location modal, a
  // "Get the app" sheet, then "Select your location". Keep clearing them and
  // re-opening the picker until the search box shows up.
  STAGE = 'opening the location picker';
  var before = currentAddress();
  for (var t = 0; t < 12 && !input && Date.now() < DEADLINE; t++) {
    if (clickText(/^continue on web$/i)) { await sleep(800); }
    else if (clickText(/^(search manually|enter (location|address|it) manually|select manually|search (for )?(area|location))$/i)) { await sleep(800); }
    else openPicker();
    for (var w = 0; w < 6 && !input; w++) { await sleep(250); input = findInput(); }
  }
  if (!input) {
    var modal = Array.prototype.slice.call(document.querySelectorAll('.ReactModal__Content,[role="dialog"]')).map(function (m) { return (m.innerText || '').slice(0, 60); }).join(' / ');
    fail('Could not open the location picker' + (modal ? '; the page shows: ' + modal.replace(/\n/g, ' ') : ''));
    return;
  }
  STAGE = 'searching for "' + QUERY + '"';
  typeInto(input, QUERY);
  var list = [];
  for (var s = 0; s < 40 && !list.length; s++) { await sleep(250); list = suggestions(); }
  if (!list.length) { fail('No matching location found'); return; }
  STAGE = 'confirming the address';
  var picked = (list[0].innerText || '').replace(/\n/g, ', ');
  list[0].click();
  // Done once the picker has closed and an address shows. (It may equal the
  // old one if the same pincode was entered again, so don't wait for a change.)
  for (var a = 0; a < 40; a++) {
    await sleep(250);
    if (currentAddress() && !findInput()) break;
  }
  await sleep(600);
  post({ ok: true, address: currentAddress() || picked, picked: picked, notServiceable: notServiceable() });
`;

export function setLocationScript(platform: PlatformId, jobId: string, query: string): string {
  return wrap(platform, jobId, `var QUERY = ${JSON.stringify(query)};\n${READ_LOCATION_FN}\n${SET_LOCATION_BODY}`);
}

export function navigateScript(url: string): string {
  return `window.__pcStale = true; window.location.href = ${JSON.stringify(url)}; true;`;
}
