# Tingee × Haravan — Implementation Plan

**Goal:** Build an MVP Node.js middleware that generates VietQR codes for Haravan orders and automatically marks orders as paid when Tingee confirms the transfer.

**Architecture:** Express.js API + static HTML pages; SQLite for persistence; `@tingee/sdk-node` for all Tingee calls; AES-256-GCM for token encryption at rest. No OAuth — merchants supply their own Haravan Private App token.

**Tech Stack:** Node.js 20 LTS, Express, better-sqlite3, @tingee/sdk-node, Jest, Supertest

---

## File Structure

```
src/
  app.js              Express app setup — mounts all routes, serves /public
  server.js           Entry point — loads .env and starts the HTTP server
  db/
    schema.js         SQL CREATE TABLE statements for all 5 tables
    index.js          Opens SQLite connection, runs schema on startup, exports db
  services/
    haravan.js        validateToken, getOrder, markOrderPaid
    tingee.js         getVaList, generateQR (always via @tingee/sdk-node)
  routes/
    config.js         /api/config/** — merchant setup endpoints
    payment.js        /api/payments — create payment, poll status
    webhook.js        /webhook/tingee — Tingee IPN receiver
    pages.js          GET / and GET /pay — serve HTML pages
  utils/
    crypto.js         encrypt(text, keyHex) and decrypt(cipher, keyHex)
    reconcile.js      generateReconcileCode() — returns TG + 7 alphanumeric chars
public/
  setup.html          Merchant 3-step configuration wizard
  pay.html            Customer QR payment page
tests/
  utils/              crypto.test.js, reconcile.test.js
  services/           haravan.test.js, tingee.test.js
  routes/             config.test.js, payment.test.js, webhook.test.js
.env.example
package.json
```

---

## Phase 1: Project Setup

- [ ] Initialise git repository
- [ ] Create `package.json` with scripts: `start`, `dev` (node --watch), `test` (jest --runInBand)
- [ ] Add dependencies: `express`, `better-sqlite3`, `@tingee/sdk-node`, `dotenv`
- [ ] Add dev dependencies: `jest`, `supertest`
- [ ] Run `npm install`
- [ ] Create `.env.example` with `PORT`, `DB_PATH`, `ENCRYPTION_KEY`, `NODE_ENV`
- [ ] Create the full folder structure: `src/db/`, `src/services/`, `src/routes/`, `src/utils/`, `public/`, `tests/utils/`, `tests/services/`, `tests/routes/`
- [ ] Create `src/app.js` — Express instance, JSON middleware, static `/public` serving, `GET /health` returning `{ status: "ok" }`
- [ ] Create `src/server.js` — loads `.env`, imports `app.js`, calls `app.listen(PORT)`
- [ ] Verify: `npm run dev` starts without errors; `curl localhost:3000/health` returns `{"status":"ok"}`
- [ ] Commit: `feat: project bootstrap`

---

## Phase 2: Core UI

Build the visual shells of both pages as static HTML. No API calls yet — just layout, styling, and the UI states that will be wired up later.

**`public/setup.html` — Merchant configuration wizard**

- [ ] Page heading and short subtitle explaining the 3-step process
- [ ] Step 1 card: inputs for shop domain and Haravan API token; "Confirm" button; error message area below button
- [ ] Step 2 card: inputs for Tingee Client ID and Secret Token; "Get accounts" button; error message area
- [ ] Step 3 card: dropdown for account selection (starts empty); "Complete setup" button; error message area
- [ ] Steps 2 and 3 visually locked (greyed out, non-interactive) until the previous step completes
- [ ] Completed steps show a visual "done" state (green border or checkmark)
- [ ] Success message shown after Step 3 is confirmed
- [ ] Verify manually: open in browser, check layout and step locking works by toggling CSS classes in DevTools

**`public/pay.html` — Customer QR payment page**

- [ ] Loading state shown on initial load ("Loading payment info…")
- [ ] Payment content area (hidden until loaded): transfer amount, QR image placeholder, transfer note display, "keep note unchanged" warning box
- [ ] Status area with three states: pending (spinner + "Waiting for payment…"), paid (success message), mismatch (warning message)
- [ ] Error state for when the page cannot load (no order ID in URL, or API failure)
- [ ] Verify manually: open in browser, toggle between states in DevTools

---

## Phase 3: Core Backend Logic

Build the database, utilities, and API services. Test each in isolation with unit/service tests before connecting them to routes.

**Database**

- [ ] Create `src/db/schema.js` — SQL `CREATE TABLE IF NOT EXISTS` statements for all 5 tables: `merchants`, `tingee_configs`, `tingee_accounts`, `payments`, `webhook_events` (see data model in `specs/product-spec.md`)
- [ ] Create `src/db/index.js` — opens `better-sqlite3` connection to `DB_PATH`, enables WAL mode and foreign keys, runs schema on startup, exports the `db` singleton
- [ ] Write `tests/db/schema.test.js` — verify all 5 tables exist after init; verify `payments.reconcile_code` has UNIQUE constraint
- [ ] Verify: `npm test tests/db` passes

**Utilities**

- [ ] Create `src/utils/crypto.js` — `encrypt(text, keyHex)` using AES-256-GCM (random IV each call); `decrypt(cipher, keyHex)` that throws on tampered input
- [ ] Write `tests/utils/crypto.test.js` — round-trip test, two encryptions of same input differ, tamper detection throws
- [ ] Create `src/utils/reconcile.js` — `generateReconcileCode()` returns `TG` followed by 7 random uppercase alphanumeric characters using `node:crypto`
- [ ] Write `tests/utils/reconcile.test.js` — format matches `TG[A-Z0-9]{7}`; 1000 generated codes are all unique
- [ ] Verify: `npm test tests/utils` passes

**Services**

- [ ] Create `src/services/haravan.js` with three functions:
  - `validateToken(token)` — `GET /com/shop.json` with Bearer auth; throws on non-200
  - `getOrder(token, orderId)` — `GET /com/orders/{id}.json`; throws on non-200
  - `markOrderPaid(token, orderId, amount)` — `POST /com/orders/{id}/transactions.json` with body `{ transaction: { kind: "Capture", amount } }`; throws on non-200
- [ ] Write `tests/services/haravan.test.js` — mock global `fetch`; test happy path and error path for each function; verify request URL and body shape
- [ ] Create `src/services/tingee.js` with two functions:
  - `getVaList(clientId, secretToken)` — calls `@tingee/sdk-node` to `POST /v1/get-va-paging`; throws if response code is not `"00"`
  - `generateQR(clientId, secretToken, { bankBin, accountNumber, amount, content })` — calls `@tingee/sdk-node` to `POST /v1/generate-viet-qr`; returns `{ qrCode, qrCodeImage }`; throws on non-`"00"`
- [ ] Write `tests/services/tingee.test.js` — mock `@tingee/sdk-node`; verify `getVaList` returns items; verify `generateQR` passes correct fields including `content`; verify both throw on error codes
- [ ] Verify: `npm test tests/services` passes

---

## Phase 4: Connect UI to Data

Create all routes, mount them in `app.js`, then wire the HTML pages to call the API.

**Config routes — `src/routes/config.js`**

- [ ] `GET /api/config` — returns `{ haravanConfigured, tingeeConfigured, accountSelected }` as booleans; never returns raw tokens
- [ ] `POST /api/config/haravan` — calls `haravan.validateToken`, encrypts token with `crypto.js`, upserts into `merchants`; returns `{ ok: true }`
- [ ] `POST /api/config/tingee` — calls `tingee.getVaList`, encrypts secret, upserts into `tingee_configs`; returns `{ accounts: [...] }`
- [ ] `POST /api/config/account` — clears existing default, inserts selected account into `tingee_accounts` with `is_default = 1`; returns `{ ok: true }`
- [ ] Write `tests/routes/config.test.js` using Supertest + `:memory:` SQLite; mock `haravan` and `tingee` services; test full setup flow and `GET /api/config` before and after

**Payment routes — `src/routes/payment.js`**

- [ ] `POST /api/payments` — reads merchant + config + default account from DB; if a pending payment already exists for the same `orderId`, return it; otherwise generate a reconcile code, call `tingee.generateQR`, save to `payments`; returns `{ reconcileCode, qrCodeImage, status }`
- [ ] `GET /api/payments/:code/status` — looks up payment by reconcile code; returns `{ status, amount, paid_at }` or 404
- [ ] Write `tests/routes/payment.test.js` — test create, idempotency for same orderId, status poll, 404 for unknown code

**Webhook handler — `src/routes/webhook.js`**

- [ ] Receive `POST /webhook/tingee`; read `x-request-timestamp` and `x-signature` from headers
- [ ] Verify signature: `HMAC-SHA512(timestamp + ":" + JSON.stringify(body), secretToken)`; if invalid, log to `webhook_events` and return `200 { code: "00" }` immediately
- [ ] Check `webhook_events` for duplicate `transactionCode`; if seen, return 200 immediately
- [ ] Extract reconcile code from `content` field using pattern `TG[A-Z0-9]+`; look up in `payments`
- [ ] If not found or amount mismatch: log event, update payment status to `mismatch` if needed, return 200
- [ ] If match: call `haravan.markOrderPaid`, update `payments.status` to `paid`, log `webhook_events` with `matched_payment_id`; return `200 { code: "00", message: "Success" }`
- [ ] Write `tests/routes/webhook.test.js` — test valid signature + match, invalid signature, duplicate, amount mismatch

**Pages router — `src/routes/pages.js`**

- [ ] `GET /` → serve `public/setup.html`
- [ ] `GET /pay` → serve `public/pay.html`

**Mount all routers in `src/app.js`**

- [ ] Add `configRouter`, `paymentRouter`, `webhookRouter`, `pagesRouter` to `app.js`
- [ ] Verify: `npm test` passes for all route tests

**Wire `setup.html` to the API**

- [ ] Step 1 button calls `POST /api/config/haravan`; on success advances to Step 2
- [ ] Step 2 button calls `POST /api/config/tingee`; on success populates account dropdown from returned list
- [ ] Step 3 button calls `POST /api/config/account` with selected account fields; on success shows success message

**Wire `pay.html` to the API**

- [ ] On load: read `order_id` and `amount` from URL params; call `POST /api/payments`; display returned `qrCodeImage` and `reconcileCode`; hide loading state
- [ ] Poll `GET /api/payments/:code/status` every 3 seconds
- [ ] On `paid`: show success message, stop polling
- [ ] On `mismatch`: show warning message, stop polling

---

## Phase 5: Validation and Error States

**API validation**

- [ ] `POST /api/config/haravan` returns 400 if `shopDomain` or `apiToken` is missing
- [ ] `POST /api/config/haravan` returns 400 with error message if Haravan rejects the token (401)
- [ ] `POST /api/config/tingee` returns 400 if `clientId` or `secretToken` is missing
- [ ] `POST /api/config/tingee` returns 400 if Tingee rejects the credentials
- [ ] `POST /api/config/account` returns 400 if any required account field is missing
- [ ] `POST /api/config/account` returns 400 if Tingee config hasn't been saved yet
- [ ] `POST /api/payments` returns 400 if `orderId` or `amount` is missing
- [ ] `POST /api/payments` returns 503 if the app hasn't been fully configured yet

**Security**

- [ ] `GET /api/config` response body must not contain `api_token_enc`, `secret_enc`, or any raw credential value — verify in tests
- [ ] Webhook handler returns `200 { code: "00" }` for invalid signatures, not a 4xx — verify in tests
- [ ] Webhook handler does not call `haravan.markOrderPaid` a second time for a duplicate `transactionCode` — verify in tests

**UI error states**

- [ ] Setup wizard shows an inline error below the button if an API call fails at any step; user can correct and retry
- [ ] Pay page shows a clear error if `order_id` is missing from the URL
- [ ] Pay page shows a clear error if the `POST /api/payments` call fails
- [ ] Pay page shows a mismatch warning (not a generic error) when status is `mismatch`

---

## Phase 6: Local Run Instructions

Document the full local setup flow in `README.md` so any developer can get it running from a clean clone.

- [ ] Step 1: `npm install`
- [ ] Step 2: Copy `.env.example` to `.env`; generate `ENCRYPTION_KEY` by running `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`; paste result into `.env`
- [ ] Step 3: `npm run dev` — server starts on `PORT` (default 3000)
- [ ] Step 4 (for webhook testing): install ngrok; run `ngrok http 3000`; copy the HTTPS URL
- [ ] Step 5: In Tingee Developers portal, set Webhook URL to `https://<ngrok-url>/webhook/tingee`
- [ ] Step 6: Open `http://localhost:3000` and complete the 3-step merchant setup
- [ ] Verify: repeat these steps from a fresh clone on a clean machine (or use a temp directory) to confirm they work end-to-end

---

## Phase 7: Demo Setup

Steps to prepare a live end-to-end demo using real (UAT) credentials.

- [ ] Create a Haravan Partner account at `partners.haravan.com` (free); create a dev store
- [ ] In the dev store's Haravan Admin: create a Private App named "Tingee Payment"; grant Orders: Read and Write; copy the token
- [ ] Log in at `app.tingee.vn` → Developers; copy Client ID and Secret Token (UAT environment)
- [ ] Set the Tingee webhook URL to your running app's `/webhook/tingee` endpoint
- [ ] Open the app's setup page and complete all 3 steps using the above credentials
- [ ] In Haravan Admin → Settings → Payments → Manual Payment Methods: add a method named `Chuyển khoản ngân hàng (QR)`; add payment instructions with the link `https://your-app-domain/pay?order_id=ORDER_ID&amount=AMOUNT`
- [ ] Place a test order on the dev store; navigate to the payment page URL for that order
- [ ] Verify the QR renders and the transfer note (reconcile code) is visible
- [ ] Make a test transfer via a banking app (UAT amounts); confirm the order moves to "Đã thanh toán" in Haravan within a few seconds
- [ ] Confirm the pay page shows the success message
- [ ] Check the `webhook_events` table to confirm the IPN was logged with `matched_payment_id` set
- [ ] Test edge cases:
  - [ ] Send the webhook request a second time (replay) — confirm `markOrderPaid` is not called again
  - [ ] Transfer a wrong amount — confirm order is NOT marked paid and status is `mismatch`
  - [ ] Send a request with a forged signature — confirm the order is not affected
