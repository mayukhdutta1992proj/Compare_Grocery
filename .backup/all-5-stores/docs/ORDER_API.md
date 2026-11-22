# Grocery Order API (v1)

The Grocery Compare app keeps an **order history** on the phone and can push it to an external dashboard, such as the Dutta Family Dashboard (**Finance → Total grocery spending**). This document is the contract between the two.

- In the app, all order access goes through the `OrdersApi` interface ([src/orders/types.ts](../src/orders/types.ts)). Today it's backed by phone storage ([src/orders/localApi.ts](../src/orders/localApi.ts)).
- Sync is a separate client ([src/orders/sync.ts](../src/orders/sync.ts)). It's **off** until a dashboard URL and key are entered in **Settings → Family dashboard link**.

## Data model: `GroceryOrder` (schemaVersion 1)

```jsonc
{
  "id": "ord_mbx1k2_9f3a7c1d",          // stable, generated on the phone; use as the database key (upsert)
  "schemaVersion": 1,
  "store": "zepto",                     // "blinkit" | "zepto" | "instamart" | "bigbasket" | "amazon"
  "placedAt": "2026-11-22T19:41:05.000+05:30",  // ISO 8601 with offset
  "items": [
    { "name": "Tata Salt | Free Flowing and Iodized Namak", "qty": "1 pack (1 kg)", "unitPrice": 31, "count": 1 },
    { "name": "Engine Kachi Ghani Mustard Oil | Pouch",      "qty": "1 pack (1 l)",  "unitPrice": 239, "count": 3 }
  ],
  "itemsTotal": 748,                    // sum of unitPrice x count (₹)
  "fees": 16,                           // total - itemsTotal (delivery, handling…) (₹)
  "total": 764,                         // AMOUNT ACTUALLY PAID (₹) - use this for spending
  "currency": "INR",
  "source": "app",                      // "app" (from the app's cart) | "manual"
  "storeOrderRef": "ORD12345",          // optional, the store's order number
  "note": "…",                          // optional
  "createdAt": "2026-11-22T19:42:10.000+05:30",
  "updatedAt": "2026-11-22T19:42:10.000+05:30",
  "deleted": true                       // only present when the order was deleted on the phone
}
```

Rules:
- **Spending uses `total`.** `itemsTotal` and `fees` are for display.
- Amounts are rupees as numbers (with up to 2 decimals), not paise.
- `id` never changes. An edited order is sent again with the same `id` and a newer `updatedAt`.
- A deleted order is sent once with `"deleted": true`. The dashboard should delete it, or hide it from totals.
- Breaking changes bump `schemaVersion`. The server should reject versions it doesn't know (`400`).
- New `store` values may be added without a version bump (Instamart, BigBasket and Amazon Fresh were added this way). Store unknown values as they are, rather than rejecting the order.

## Endpoint the dashboard implements

### `POST /api/finance/grocery-orders`: upsert a batch

Request:

```http
POST /api/finance/grocery-orders
Authorization: Bearer <dashboard API key>
Content-Type: application/json

{ "schemaVersion": 1, "orders": [ GroceryOrder, ... ] }
```

Response `200`:

```json
{ "accepted": ["ord_mbx1k2_9f3a7c1d"], "rejected": [{ "id": "ord_x", "error": "invalid total" }] }
```

- The app marks only the `accepted` ids as synced, and retries the rest next time.
- If `accepted` is missing from a `200` response, the app treats the whole batch as accepted.
- Errors: `401` bad or missing key, `403` key not allowed to write Finance, `400` bad payload or unknown `schemaVersion`. Put a human-readable message in `{ "error": "..." }`; the app shows it in Settings.
- Must be idempotent. The app may resend the same order (same `id` + `updatedAt`) after a network error.

When the app sends:
- right after an order is saved, edited or deleted;
- when **Save and sync** is tapped in Settings;
- when **Sync now** is tapped on the Orders tab.

Only orders not yet accepted are sent.

### Suggested read endpoint (dashboard-internal)

`GET /api/finance/grocery-spending?from=2026-11-01&to=2026-12-01` should return the same shape as the app's `SpendSummary`. The app computes this locally in [src/orders/summary.ts](../src/orders/summary.ts), and the logic can be reused:

```json
{
  "currency": "INR",
  "from": "2026-11-01", "to": "2026-12-01",
  "orderCount": 7,
  "totalSpend": 4218.5,
  "byStore": { "blinkit": { "orders": 3, "total": 1610 }, "zepto": { "orders": 4, "total": 2608.5 }, "instamart": { "orders": 0, "total": 0 }, "bigbasket": { "orders": 0, "total": 0 }, "amazon": { "orders": 0, "total": 0 } },
  "byMonth": [ { "month": "2026-11", "orders": 7, "total": 4218.5 } ]
}
```

## Notes for implementing it in the Dutta Family Dashboard

These follow that project's own rules in its `CLAUDE.md`. Nothing has been changed in the dashboard yet.

- **Store data on the server only.** Write to Firestore through the Admin SDK inside the API route (`src/lib/firebaseAdmin.ts`). Never write from the client. A collection such as `grocery_orders`, keyed by `id`, works well.
- **Authentication is an API key, not a browser session.** The phone calls with a bearer key, so the route must map that key to a user. Issue one key per user, stored hashed, and revocable.
- **Check Finance access for that user** with `getRequestPermissions()` / `canViewSection(role, permissions, 'finance')`. Don't rely on the key alone, and don't bypass the check for admins: a "Non-Personal" admin may not have Finance access.
- **Don't hardcode a "Groceries" category or section name.** Resolve it from the admin-managed collections, the same way the dashboard does elsewhere.
- **Total grocery spending** is the sum of `total` over non-deleted orders in the period, optionally split by `store` or month as in `SpendSummary`.
- **Cost:** this adds one small Firestore write per order and keeps the dashboard at ₹0/month.

## Testing the contract without the dashboard

Any HTTPS endpoint that returns `{ "accepted": [ids] }` works. Enter its base URL and any key in **Settings → Family dashboard link**, then tap **Save and sync**. The app logs nothing sensitive, and the key stays in the iPhone keychain.
