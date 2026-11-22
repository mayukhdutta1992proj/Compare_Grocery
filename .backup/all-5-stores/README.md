# Grocery Compare

A personal iPhone app that compares prices for your shopping list across **Blinkit**, **Zepto**, **Swiggy Instamart**, **BigBasket** and **Amazon Fresh**. It recommends the cheapest way to buy it (counting delivery and handling fees) and adds the chosen items to your **real** cart on each store.

Store notes:
- **Delivery location:** the pincode is set automatically on Blinkit and Zepto. Instamart, BigBasket and Amazon Fresh need you to choose it once on the **Stores** tab (Amazon only accepts a location typed by a person).
- **Instamart needs you to log in** on the Stores tab before it shows products.
- **Removing items:** on Instamart, and for the last unit on Amazon, remove items in the store's own cart (Stores tab); their search pages can't do it.
- **Switching stores off:** use **Settings → Stores to compare**. Each store runs in its own hidden browser, so fewer stores means faster comparisons.
- **Desktop sites:** Instamart, BigBasket and Amazon load their desktop sites; see [docs/NEW_STORES_NOTES.md](docs/NEW_STORES_NOTES.md).

## How it works

Neither Blinkit nor Zepto has a public API, so the app runs each site's mobile website inside a hidden in-app browser (a WebView):

0. **Delivery pincode** (the "Deliver to" pill at the top): enter a pincode, or an area + pincode. The app types it into both stores' location pickers, picks the first match, and shows the address each store confirmed. Prices and stock follow this location.
1. **Stores tab**: you log in to each site once with your phone number + OTP. The login is saved in the app.
2. **Basket tab**: type your items ("amul butter 100g", "toned milk 1l") and how many of each, or tap **Import a list** (or the 📎 in the input). You can pick up to 10 photos or files at once; they are read in turn and merged into one list:
   - **Excel (.xlsx/.xls), CSV, text**: read on the phone. The app finds the item/quantity/size columns from the header row, or guesses them. In text it understands "2 x milk", "milk x2", "bread - 2", "3 pcs maggi", and keeps sizes like "1kg sugar" in the name.
   - **Photo** (printed list, screenshot, bill): **free**, read on the phone by Tesseract OCR running in a hidden WebView (`src/OcrEngine.tsx`). No key or account is needed, and the photo never leaves the phone. The first use downloads about 4 MB of English language data, which is then cached. Prices, totals, dates and phone numbers are stripped before parsing.
   - **Handwritten photo (optional)**: in the review sheet, tap "Read with AI instead". This uses:
     - **Gemini (free)** if you save a free Google AI Studio key in **Settings**. It tries `gemini-3.5-flash-lite`, then `gemini-3.6-flash`, then `gemini-2.5-flash-lite`, and has daily limits. Google may use free-tier content to improve its products.
     - otherwise **Claude (paid)**, `claude-opus-5-5` with structured output, at roughly ₹1–3 per photo.
     Keys are stored in the iPhone keychain. Neither is used unless you tap that option.
   - **Paste copied list**: from WhatsApp, Notes, or iOS Live Text (long-press text in any photo, then Copy). Free.
   Everything opens in a review sheet first, where you can untick items, edit names and change counts.
3. **Compare tab**: the app searches both sites for each item and picks the closest match. It shows price, MRP and price per 100 g/ml, then recommends one of:
   - everything on Blinkit,
   - everything on Zepto, or
   - a split order (cheapest of each item), with fees counted.
   Tap a column to switch an item to the other app, or **Change** to choose a different product.
4. **Add to cart** (per item, or **Add all**): the app presses the site's own ADD / + buttons, so the items go into your cart on that website. Then open the **Accounts** tab (or tap "open cart" on the Compare tab) and check out there.

Because the cart lives on the *website* session, it may not appear in the official Blinkit/Zepto apps. Check out inside this app.

## Run it on your iPhone (no Mac needed)

You need: this PC and your iPhone on the **same Wi-Fi**, and the free **Expo Go** app from the App Store.

```bash
cd C:\Users\Mayuk\Downloads\Price_compare
npx expo start
```

A QR code appears in the terminal. Open the iPhone **Camera**, point it at the QR code, and tap the banner to open the app in Expo Go.

- If the phone can't connect (different network, office Wi-Fi, etc.) use `npx expo start --tunnel`.
- The PC has to keep running `npx expo start` while you use the app this way.
- To install the app permanently on the iPhone without the PC, you need an Apple Developer account (US$99/yr), then `npx eas-cli build --platform ios`.

## Limitations

- **The sites can change.** The app reads the page text and the ADD / + buttons, not hidden class names, so small redesigns usually don't break it. A big redesign will, and the fix lives in `src/scripts.ts`.
- **Prices depend on your address.** Set your address in the Accounts tab, or results are for a default location.
- **Stock and per-order limits are real.** If a site caps an item (for example "We only have 1 piece left"), the app adds as many as allowed and shows the site's message.
- **Fees are estimates.** Copy the real delivery, handling and small-cart fees from a recent bill into Settings.
- **Personal use only.** Automating these sites is against their terms at scale.

## Code map

| File | What it does |
|---|---|
| `App.tsx` | Tabs, compare/add-to-cart orchestration |
| `src/BrowserHost.tsx` | The hidden WebViews + a job queue per site (search, set cart quantity) |
| `src/scripts.ts` | JavaScript injected into the sites: read products, press ADD / + / − |
| `src/match.ts` | Match ranking, size/unit-price parsing, fee-aware plan comparison |
| `src/platforms.ts` | Site URLs and default fees |
| `src/screens/*` | List, Compare and Settings screens |
| `src/store.ts` | Saves list, results and settings on the phone |

## Order history and grocery spending

- **Orders tab**: this month's grocery spending (split by store), the last 30 days, all time and monthly totals, plus every past order with its date, time, store and total. Tap an order to see its items, correct the amount or delete it.
- **Saving orders**: after checking out in the **Stores** tab, tap **Save order**. It's prefilled with the items the app added to that store's cart and estimated fees; correct the total to what you paid. The app also asks "Did you just place an order?" when a store page looks like an order confirmation. That check is a guess based on the page address, and it only asks. You can also add orders manually.
- **API for the family dashboard**: orders follow a versioned data contract and are accessed only through the `OrdersApi` interface (`src/orders/`). With a dashboard address and key entered in **Settings → Family dashboard link**, new or changed orders are sent to `POST /api/finance/grocery-orders`. See [docs/ORDER_API.md](docs/ORDER_API.md) for the contract and implementation notes for the Dutta Family Dashboard.
