# Instamart, BigBasket and Amazon Fresh: store notes

> **2026-11-22: stores are now added one at a time.** The app currently has Blinkit, Zepto and **Amazon Fresh** only. Instamart and BigBasket were removed; their adapters are kept in `.backup/all-5-stores/src/scripts.ts` and the notes below still describe their sites.

Inspected on 2026-11-22 in a desktop browser. **Implemented** in `src/scripts.ts` (per-store adapters), `src/platforms.ts` (`site: "desktop"`, `autoLocation`) and `src/BrowserHost.tsx` (desktop user agent and a 1200px viewport for these stores).

Tested on the live sites from a desktop browser: Amazon Fresh (reading products, add, +, −) and BigBasket (reading products, add, +, −). Instamart now shows a login wall even on the desktop site, so its reader (built from the structure seen earlier) still needs checking once you have logged in on the Stores tab.

## Swiggy Instamart
- **Mobile website requires login before showing anything.** In the app, use a **desktop user agent** for Instamart's WebView (the desktop site shows results without login).
- Search URL: `https://www.swiggy.com/instamart/search?query=<q>` (it redirects to `...&custom_back=true&query=a+b`).
- Card: element `[data-testid="item-collection-card-full"]`. Its parent's parent holds the pack size and price. Text pieces in order: ETA ("12 MINS"), name, description, size ("100 g"), price as a bare number ("70"; the ₹ sign is drawn as an image).
- Add: `[data-testid="buttonpair-add"]` (aria-label "Add item to cart"). The card keeps showing "+" after adding. The cart count is in `[data-testid="bottom-cart-hud"]` (aria-label "Cart item quantity is N").
- The search page has no minus button, so removing items has to happen in the cart (Stores tab).
- No product id in the card. Clicking sets `comp_item=<ID>` in the URL. Use name + size as the id.
- Location: header `[data-testid^="address-bar-placeholder"]`. Not inspected further (the page stays blank while the browser pane is hidden). Plan: the user sets it once on the Stores tab.

## BigBasket
- The desktop site works without login. Search: `https://www.bigbasket.com/ps/?q=<q>`.
- Card: `ul li` containing `a[href*="/pd/"]` and a button with text "Add". Id: the number in `/pd/<id>/`.
- Text pieces in order: ETA "10 mins", brand (SPAN), name (H3), rating "4.1", "8063 Ratings", size "500 g - Carton", "₹340.00", optional MRP, "₹5 OFF" (discount), "Add".
- After Add: a count `<span>` appears ("1"). Its grandparent holds two icon buttons: **first = minus** (tested), last = plus (didn't raise the count in the test, probably a per-order limit).

## Amazon Fresh
- Search: `https://www.amazon.in/s?k=<q>&i=nowstore`. **No results until a pincode is set.**
- Pincode: `#nav-global-location-popover-link` opens `#GLUXZipUpdateInput` + `#GLUXZipUpdate`. **Scripted typing is rejected** ("Please enter a valid pincode"); real typing works. So the user sets the pincode on the Stores tab (Amazon then shows "Bidhan Nagar 700064" in `#glow-ingress-line2`).
- Card: `[data-component-type="s-search-result"][data-asin]`, id = `data-asin`.
  - Name: text inside `[data-cy="title-recipe"]` (brand span `.a-size-base-plus` + title span), e.g. "Nutralite DoodhShakti Probiotic Butter Spread 500g.". The size is only in the title.
  - Price: `[data-cy="price-recipe"] .a-price:not(.a-text-price) .a-offscreen`. MRP: `.a-price[data-a-strike="true"] .a-offscreen`. `(₹61/100 g)` is the unit price; don't treat it as MRP.
  - Rating: `.a-icon-alt` ("4.0 out of 5 stars"); count "(1K)" / aria-label "1,770 ratings". Sponsored: `.puis-sponsored-label-text`.
  - Add: `input[name="submit.addToCart"]`. After clicking, the card shows "1 in cart" and buttons aria-label "Increase quantity by one" / "Minimum quantity is 1" (decrease). (The nav cart count didn't update in the guest session.)

## Original plan (done)
1. Make the platform code generic: `PlatformId` → 5 stores; per-store adapters in `src/scripts.ts` (cards, name/size/price, add/step, order-confirmation URLs); per-store user agent (desktop for Instamart, possibly BigBasket and Amazon).
2. Replace every `{ blinkit, zepto }` literal (App, store defaults, `DEFAULT_SETTINGS` fees, `byStore` in orders) with a map over `PLATFORM_IDS`.
3. UI: Compare tiles in a horizontal scroll sorted by price; store chips on the Stores tab; fees, location sheet and Orders totals for all stores; Settings toggle to turn stores on/off (and skip their WebViews).
4. Orders: `StoreId` gets 3 new values (additive); update `docs/ORDER_API.md`.
5. Gemini matching prompt (`src/aiMatch.ts`) builds its schema from the enabled stores.
6. Test each adapter on the live sites, then typecheck and bundle.
