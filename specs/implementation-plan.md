# Tingee × Haravan — Implementation Plan

**Goal:** Build a Haravan Public App that adds VietQR bank transfer as a payment method. Merchants install the app once via OAuth; the app injects a script into the storefront that redirects customers to the payment page automatically. Tingee webhooks confirm transfers and mark orders paid on Haravan.

**Architecture:** Haravan Public App (OAuth 2.0 + Script Tags API) + Express.js API + static HTML pages; SQLite (dev) / PostgreSQL (prod); `@tingee/sdk-node` for Tingee calls; AES-256-GCM for token encryption at rest. Multi-tenant — one deployment serves all merchants.

**Tech Stack:** Node.js 20 LTS, Express, TypeScript 5, better-sqlite3, @tingee/sdk-node, Jest + ts-jest, Supertest, tsx (dev runner)

---

## File Structure

```
src/
  app.ts              Express app setup — mounts all routes, serves /public
  server.ts           Entry point — loads .env and starts the HTTP server
  db/
    schema.ts         SQL CREATE TABLE statements for all 6 tables
    index.ts          Opens SQLite connection, runs schema on startup, exports db
  services/
    haravan.ts        getShop, getOrder, markOrderPaid, registerScriptTag
    tingee.ts         getVaList, generateQR (always via @tingee/sdk-node)
  routes/
    auth.ts           GET /auth/haravan, GET /auth/haravan/callback (OAuth flow)
    config.ts         /api/config/** — Tingee setup endpoints (shop-scoped)
    payment.ts        /api/payments — create payment, poll status (shop-scoped)
    webhook.ts        /webhook/tingee — Tingee IPN receiver
    pages.ts          GET /install, GET /setup, GET /pay — serve HTML pages
  utils/
    crypto.ts         encrypt(text, keyHex) and decrypt(cipher, keyHex)
    reconcile.ts      generateReconcileCode() — returns TG + 7 alphanumeric chars
public/
  install.html              Merchant install landing page — "Install" button
  setup.html                Post-install 2-step Tingee config wizard
  pay.html                  Customer QR payment page
  payment-redirect.js       Script injected into Haravan storefront via Script Tags API
tests/
  utils/              crypto.test.ts, reconcile.test.ts
  services/           haravan.test.ts, tingee.test.ts
  routes/             auth.test.ts, config.test.ts, payment.test.ts, webhook.test.ts
.env.example
package.json
tsconfig.json
```

---

## Phase 1–4: Completed (single-tenant MVP)

Phases 1–4 are fully implemented and all tests pass. The code in these phases provides the foundation (DB, crypto, Tingee service, Haravan service, route skeletons, HTML pages) that will be refactored in phases 5–7.

---

## Phase 5: Haravan OAuth 2.0 App

**Goal:** Replace manual Haravan token entry with an OAuth 2.0 install flow. After this phase, a merchant installs the app and Haravan grants access automatically — no token pasting needed. Multi-tenant from day one.

**Prerequisites (manual — not code):**
- Register app at `partners.haravan.com` → Apps → Create App
- Set OAuth redirect URI to `${APP_URL}/auth/haravan/callback`
- Copy `Client ID` (= `HARAVAN_API_KEY`) and `Client Secret` (= `HARAVAN_API_SECRET`)

**Environment variables — update `.env.example`:**
- [x] Add `HARAVAN_API_KEY` — from Haravan Partner portal (Client ID)
- [x] Add `HARAVAN_API_SECRET` — from Haravan Partner portal (Client Secret)
- [x] Add `APP_URL` — public HTTPS URL of this app (e.g. `https://your-app.railway.app`)

**DB Schema changes — `src/db/schema.ts`:**
- [x] Add `oauth_states` table: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `state TEXT UNIQUE NOT NULL`, `shop TEXT NOT NULL`, `created_at INTEGER NOT NULL` — used for CSRF protection during OAuth
- [x] Update `merchants` table: rename `api_token_enc` → `access_token_enc`; add `scope TEXT`; add `installed_at INTEGER`
- [x] Drop and recreate DB on dev (delete `data/db.sqlite`); update any tests that reference `api_token_enc`

**Update `src/services/haravan.ts`:**
- [x] Rename param `token` → `accessToken` everywhere for clarity
- [x] Update `validateToken(accessToken)` → rename to `getShop(accessToken, shop)` — `GET https://apis.haravan.com/com/shop.json` with `Authorization: Bearer {accessToken}`; returns shop data; throws on non-200
- [x] Keep `getOrder(accessToken, orderId)` — same logic, renamed param
- [x] Keep `markOrderPaid(accessToken, orderId, amount)` — same logic, renamed param
- [x] Add `registerScriptTag(accessToken, shop, scriptUrl)` — `POST https://apis.haravan.com/com/script_tags.json` with body `{ script_tag: { event: "onload", src: scriptUrl } }`; throws on non-200

**New route file — `src/routes/auth.ts`:**
- [x] `GET /auth/haravan`
  - Read `shop` query param; if missing return 400
  - Validate format: must match `*.myharavan.com`
  - Generate random `state` nonce: `crypto.randomBytes(16).toString('hex')`
  - Insert `{state, shop, created_at: Date.now()}` into `oauth_states`
  - Redirect to: `https://${shop}/admin/oauth/authorize?client_id=${HARAVAN_API_KEY}&scope=read_orders,write_orders&redirect_uri=${APP_URL}/auth/haravan/callback&state=${state}`
- [x] `GET /auth/haravan/callback`
  - Read `code`, `shop`, `state`, `hmac` from query params
  - Verify `state` exists in `oauth_states` with matching `shop`; delete it (one-time use)
  - Verify Haravan HMAC: remove `hmac` from params, sort remaining key=value pairs alphabetically, join with `&`, compute `HMAC-SHA256(message, HARAVAN_API_SECRET)` — reject if mismatch
  - Exchange code: `POST https://${shop}/admin/oauth/access_token` with body `{ client_id: HARAVAN_API_KEY, client_secret: HARAVAN_API_SECRET, code }` → get `{ access_token, scope }`
  - Encrypt `access_token` with `crypto.ts`
  - Upsert into `merchants`: `INSERT ... ON CONFLICT(shop_domain) DO UPDATE SET access_token_enc = ..., scope = ..., installed_at = ...`
  - Call `haravan.registerScriptTag(access_token, shop, `${APP_URL}/payment-redirect.js`)`
  - Redirect to `${APP_URL}/setup?shop=${shop}`

**Update `src/routes/config.ts`:**
- [x] Remove `POST /api/config/haravan` entirely
- [x] All endpoints now require `shop` query param; look up `merchant_id` via `shop_domain`
- [x] `GET /api/config?shop=SHOP` — return `{ tingeeConfigured, accountSelected, shopDomain, selectedAccount }` (remove `haravanConfigured` — always true if merchant exists)
- [x] `GET /api/config/accounts?shop=SHOP` — unchanged except merchant lookup by shop
- [x] `POST /api/config/tingee?shop=SHOP` — unchanged except merchant lookup by shop; return 404 if shop not installed
- [x] `POST /api/config/account?shop=SHOP` — unchanged except merchant lookup by shop

**Update `src/routes/payment.ts`:**
- [x] `POST /api/payments` — require `shop` in request body; look up merchant by `shop_domain`
- [x] `GET /api/payments/:code/status` — unchanged (reconcile code is globally unique)

**Update `src/routes/webhook.ts`:**
- [x] Look up merchant via: `reconcile_code → payments.merchant_id → merchants.access_token_enc` and `→ tingee_configs` for secret
- [x] Rename any reference from `api_token_enc` to `access_token_enc`
- [x] Everything else unchanged (signature verification, idempotency, markOrderPaid)

**Update `src/routes/pages.ts`:**
- [x] `GET /install` → serve `public/install.html`
- [x] `GET /setup` → serve `public/setup.html`
- [x] `GET /pay` → serve `public/pay.html`
- [x] Remove `GET /` or redirect to `/install`

**Update `src/app.ts`:**
- [x] Import and mount `authRouter` at `/auth`
- [x] Mount updated routes

**New test — `tests/routes/auth.test.ts`:**
- [x] `GET /auth/haravan` without shop → 400
- [x] `GET /auth/haravan?shop=valid.myharavan.com` → 302 redirect to Haravan OAuth URL; state saved in DB
- [x] `GET /auth/haravan?shop=invalid-domain` → 400
- [x] `GET /auth/haravan/callback` with invalid state → 400, no token stored
- [x] `GET /auth/haravan/callback` with invalid HMAC → 400
- [x] `GET /auth/haravan/callback` valid → merchant upserted; registerScriptTag called; redirect to /setup?shop=...

**Update `tests/routes/config.test.ts`:**
- [x] Remove all `POST /api/config/haravan` tests
- [x] Seed `merchants` directly (simulate post-OAuth state) instead of calling the Haravan config endpoint
- [x] Pass `?shop=SHOP` on all config requests
- [x] Verify: `npm test tests/routes/config.test.ts` passes

**Verify:** `npm test` — 85 tests pass ✓

---

## Phase 6: Script Tag — Auto-Redirect on Checkout

**Goal:** After install, the app injects a JS snippet into the merchant's Haravan storefront. When a customer reaches the order status page with a pending payment, the script redirects them to `/pay` automatically — no manual payment method link needed in Haravan Admin.

**New file — `public/payment-redirect.js`:**
- [ ] Script runs on every storefront page (loaded via script tag)
- [ ] Check if on order status / thank-you page: detect via URL path containing `/checkout/thank_you` or `window.Haravan?.checkout` presence
- [ ] Read order info from Haravan's storefront context:
  - `orderId` from `window.Haravan.checkout.order_id`
  - `amount` from `window.Haravan.checkout.payment_due` (amount still owed, in VND)
  - `shop` from `window.location.hostname`
- [ ] If `amount > 0` (payment still pending): `window.location.href = APP_URL + '/pay?order_id=' + orderId + '&amount=' + amount + '&shop=' + shop`
- [ ] If `amount === 0`: payment already completed — do nothing
- [ ] Guard against infinite redirect: check if already on the `/pay` page
- [ ] Replace `APP_URL` at build time OR embed it as a query param when registering the script tag src (e.g. `${APP_URL}/payment-redirect.js?app=${APP_URL}`)

**Update `public/pay.html`:**
- [ ] Read `shop` from URL params
- [ ] Include `shop` in all API calls: `POST /api/payments` body includes `{ orderId, amount, shop }`
- [ ] Poll URL unchanged: `GET /api/payments/:code/status`

**Update `public/setup.html`:**
- [ ] Remove Step 1 (Haravan token) — OAuth now handles authentication
- [ ] Rename to 2-step wizard: Step 1 = Tingee credentials, Step 2 = account selection
- [ ] Read `shop` from URL params (`?shop=SHOP`); pass as `?shop=SHOP` query param on all API calls
- [ ] On load: call `GET /api/config?shop=${shop}` to restore state
- [ ] Keep webhook URL box after Step 2 completes

**New file — `public/install.html`:**
- [ ] Simple landing page: app name, description, "Install" button
- [ ] "Install" button links to `GET /auth/haravan?shop=` — either pre-filled from URL param or with an input field for shop domain
- [ ] If `?shop=SHOP` in URL: show "Install for [SHOP]" directly
- [ ] If no shop param: show an input field where merchant types their shop domain, then submit goes to `/auth/haravan?shop=${input}`

**Verify:** Install app on test shop → navigate to order thank-you page → confirm script redirects to `/pay?order_id=...&amount=...&shop=...`

---

## Phase 7: Multi-tenant Verification and Validation

**Goal:** Confirm the app correctly isolates data between merchants and handles edge cases.

**Multi-tenant isolation:**
- [ ] Verify `GET /api/config?shop=shopA` never returns shopB's data
- [ ] Verify webhook from shopA's customer does not affect shopB's orders
- [ ] Verify `POST /api/payments` with shopA's token cannot generate QR using shopB's Tingee config
- [ ] Write integration test: two merchants seeded in DB; payments and webhooks correctly routed

**Guard unauthenticated merchants:**
- [ ] `GET /setup?shop=SHOP` — if shop not in `merchants` table, redirect to `/install?shop=SHOP`
- [ ] `GET /pay?shop=SHOP` — if shop not in `merchants`, return error page
- [ ] `POST /api/config/*?shop=SHOP` — if merchant not found, return 404 `{ error: "Shop not installed" }`
- [ ] `POST /api/payments` — if merchant not found, return 404 `{ error: "Shop not installed" }`

**API validation (carry over from original Phase 5):**
- [ ] `POST /api/config/tingee` returns 400 if `clientId` or `secretToken` missing
- [ ] `POST /api/config/tingee` returns 400 if Tingee rejects credentials
- [ ] `POST /api/config/account` returns 400 if `accountNumber` or `bankBin` missing
- [ ] `POST /api/config/account` returns 400 if Tingee config not saved yet
- [ ] `POST /api/payments` returns 400 if `orderId`, `amount`, or `shop` missing
- [ ] `POST /api/payments` returns 503 if merchant not fully configured (no Tingee config or no account)

**Security:**
- [ ] `GET /api/config` response must never contain `access_token_enc`, `secret_enc`, or raw credentials
- [ ] Webhook returns `200 { code: "00" }` for invalid signatures, not 4xx
- [ ] Webhook does not call `markOrderPaid` twice for duplicate `transactionCode`
- [ ] OAuth state nonce is single-use (deleted after callback)
- [ ] OAuth HMAC verification rejects forged callbacks

**UI error states:**
- [ ] Setup wizard shows inline error if API call fails; user can correct and retry
- [ ] Pay page shows error if `order_id` or `shop` missing from URL
- [ ] Pay page shows error if `POST /api/payments` fails
- [ ] Pay page shows mismatch warning (not generic error) when status is `mismatch`
- [ ] Install page shows error if shop domain format is invalid

**Verify:** `npm test` — all tests pass including new multi-tenant and validation tests

---

## Phase 8: Local Run and ngrok Setup

Document the full local development flow.

- [ ] Step 1: `npm install`
- [ ] Step 2: Copy `.env.example` to `.env`; fill in `ENCRYPTION_KEY`, `HARAVAN_API_KEY`, `HARAVAN_API_SECRET`, `APP_URL`
- [ ] Step 3: `npm run dev` — server starts on `PORT` (default 3000)
- [ ] Step 4: Run `ngrok http 3000`; copy the HTTPS URL; paste into `.env` as `APP_URL` and restart dev server
- [ ] Step 5: In Haravan Partner portal → app settings, set OAuth redirect URI to `${APP_URL}/auth/haravan/callback`
- [ ] Step 6: In Tingee Developers portal, set Webhook URL to `${APP_URL}/webhook/tingee`
- [ ] Step 7: Open `https://your-shop.myharavan.com` (dev store) → Apps → install your app → OAuth flow completes → redirect to setup page
- [ ] Step 8: Complete 2-step Tingee setup (credentials + account)
- [ ] Verify: place a test order, navigate to thank-you page, confirm script redirects to `/pay`

---

## Phase 9: Demo — End-to-End Test with Real Credentials

- [ ] Create Haravan Partner account at `partners.haravan.com`; create dev store
- [ ] Register Public App; set redirect URI and scopes (`read_orders`, `write_orders`)
- [ ] Log in at `app.tingee.vn` → Developers; copy Client ID and Secret Token (UAT environment)
- [ ] Set Tingee webhook URL to `${APP_URL}/webhook/tingee`
- [ ] Install app on dev store via OAuth; complete Tingee setup
- [ ] Confirm script tag is registered: Haravan Admin → Apps → Script Tags
- [ ] Place test order; navigate to thank-you page; confirm redirect to `/pay` and QR renders
- [ ] Make test transfer via banking app (UAT); confirm order moves to "Đã thanh toán" in Haravan
- [ ] Confirm pay page shows success message
- [ ] Check `webhook_events` table: IPN logged with `matched_payment_id` set
- [ ] Edge cases:
  - [ ] Replay webhook — confirm `markOrderPaid` not called twice
  - [ ] Wrong amount transfer — order NOT marked paid; status = `mismatch`
  - [ ] Forged signature — order unaffected
  - [ ] Install same shop twice — upsert, not duplicate merchant
  - [ ] Second merchant installs — both merchants isolated in DB
