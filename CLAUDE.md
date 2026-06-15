# CLAUDE.md — Tingee × Haravan Integration

## What This Project Is

A Haravan **Public App** that adds VietQR bank transfer as a payment method to Haravan stores. Merchants install via OAuth (no token pasting). The app injects a Script Tag into the storefront that auto-redirects customers to the payment page. When a customer transfers money, Tingee fires a webhook, the app matches the payment to the order, and marks it paid on Haravan — no human intervention needed.

Architecture model: **Public App + OAuth 2.0 + Script Tags API**. Multi-tenant — one deployment serves many merchants.

## Tech Stack

- **Node.js 20 LTS** + **Express.js** + **TypeScript 5**
- **better-sqlite3** for synchronous SQLite (dev). Production uses PostgreSQL via `pg`.
- **@tingee/sdk-node** for all Tingee API calls — never hand-roll HMAC signing
- **Jest + ts-jest + Supertest** for all tests
- **tsx** for local dev (`npm run dev`) — no compile step needed in development
- **Node built-in `fetch`** (no axios/node-fetch needed)

## Running the Project

```bash
npm install
cp .env.example .env    # fill in all required vars (see below)
npm run dev             # starts on PORT (default 3000)
npm test                # run test suite
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default 3000) |
| `DB_PATH` | No | SQLite file path (default `./data/app.db`) |
| `ENCRYPTION_KEY` | **Yes** | 64-char hex string for AES-256 encryption |
| `HARAVAN_API_KEY` | **Yes** | Haravan App Client ID (from partners.haravan.com) |
| `HARAVAN_API_SECRET` | **Yes** | Haravan App Client Secret |
| `APP_URL` | **Yes** | Public HTTPS URL of this app (e.g. `https://your-app.railway.app`) |
| `NODE_ENV` | No | `development` or `production` |

Generate encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Critical Rules — Never Break These

1. **Never reuse a reconcile code.** Each `payments` row gets one unique `reconcile_code`. `reconcile.ts` generates them; do not bypass it.

2. **Always verify Tingee webhook signatures.** `webhook.ts` must verify `x-signature = HMAC_SHA512(timestamp + ":" + JSON.stringify(body), secretToken)` before processing any IPN. Reject silently (return 200 `{code:"00"}`) on mismatch to prevent retry storms.

3. **Idempotency on `transactionCode`.** Check `webhook_events` for the `tingee_transaction_code` before processing. If already seen, return 200 immediately.

4. **Never log access tokens, API secrets, or Secret Tokens.** These are encrypted at rest using `crypto.ts`. Only decrypt immediately before use.

5. **Only mark an order paid when both reconcile code AND amount match.** Amount mismatch → set `status = 'mismatch'`, do not call Haravan.

6. **Use `accountNumber` (real account number) for QR generation**, not `vaAccountNumber`. They are different fields in the Tingee VA response.

7. **Verify OAuth state nonce.** The state saved in `oauth_states` must match the `state` param in the callback. Delete after first use. Also verify Haravan's HMAC on callback query params.

8. **All routes are shop-scoped.** Config and payment routes require a `shop` param. Webhook routes look up the merchant via `reconcile_code → payments.merchant_id`. Never `LIMIT 1` without a `WHERE merchant_id = ?`.

## Project File Map

```
src/
  app.ts          Express setup: mounts all routes, parses JSON, serves /public
  server.ts       Calls app.ts and listens on PORT — only file that starts the server
  db/
    schema.ts     All CREATE TABLE IF NOT EXISTS statements (run on startup)
    index.ts      Opens better-sqlite3 connection, runs schema.ts, exports db
  services/
    haravan.ts    getShop(token), getOrder(token, orderId), markOrderPaid(token, orderId, amount), registerScriptTag(token, shop, url)
    tingee.ts     getVaList(clientId, secretToken), generateQR(clientId, secretToken, opts)
  routes/
    auth.ts       GET /auth/haravan (start OAuth), GET /auth/haravan/callback (exchange code)
    config.ts     GET /api/config?shop, POST /api/config/tingee?shop, POST /api/config/account?shop
    payment.ts    POST /api/payments (body includes shop), GET /api/payments/:reconcileCode/status
    webhook.ts    POST /webhook/tingee
    pages.ts      GET /install, GET /setup, GET /pay
  utils/
    crypto.ts     encrypt(text, keyHex), decrypt(cipher, keyHex) — AES-256-GCM
    reconcile.ts  generateReconcileCode() — returns "TG" + 7 alphanumeric chars
public/
  install.html           Landing page — merchant types shop domain, clicks Install
  setup.html             2-step Tingee config wizard (post-OAuth)
  pay.html               Customer QR payment page (polls /api/payments/:code/status)
  payment-redirect.js    Injected into Haravan storefront via Script Tags API
tests/             Mirror of src/ — one test file per source file (.test.ts)
tsconfig.json     TypeScript compiler config (target ES2022, CommonJS, outDir dist/)
```

## Database Tables (summary)

| Table | Purpose |
|---|---|
| `merchants` | shop_domain + encrypted OAuth access_token + scope |
| `oauth_states` | Temporary CSRF nonce for OAuth flow (deleted after use) |
| `tingee_configs` | Encrypted Tingee client_id + secret_token per merchant |
| `tingee_accounts` | VA accounts; `account_number` (real) + `bank_bin` stored here |
| `payments` | One row per QR payment attempt; tracks reconcile_code → order_id |
| `webhook_events` | Raw IPN log; used for idempotency + audit |

Full schema in `src/db/schema.ts`.

## Testing Approach

- **Unit tests**: `crypto.ts`, `reconcile.ts` — pure functions, no DB
- **Service tests**: `haravan.ts`, `tingee.ts` — mock `fetch` and `@tingee/sdk-node` with Jest
- **Route tests**: use Supertest + an in-memory test DB (`:memory:` SQLite) — no network calls
- **Do not skip webhook signature verification in tests** — test both valid and invalid signatures
- **Do not skip OAuth state/HMAC verification in tests** — test both valid and forged callbacks

## Haravan API

Base URL: `https://apis.haravan.com/com`
Auth header: `Authorization: Bearer {access_token}`

Key endpoints:
- `GET /shop.json` — validate token / get shop info
- `GET /orders/{id}.json` — fetch order details
- `POST /orders/{id}/transactions.json` — body: `{"transaction":{"kind":"Capture","amount":NNN}}`
- `POST /script_tags.json` — body: `{"script_tag":{"event":"onload","src":"URL"}}`

OAuth endpoints (on the shop domain, not apis.haravan.com):
- `GET https://{shop}/admin/oauth/authorize` — redirect merchant here to start OAuth
- `POST https://{shop}/admin/oauth/access_token` — exchange code for access token

## Tingee API

Base URL (PROD): `https://open-api.tingee.vn`
Always use `@tingee/sdk-node` — it handles HMAC-SHA512 signing automatically.

Key endpoints:
- `POST /v1/get-va-paging` — list VA accounts
- `POST /v1/generate-viet-qr` — generate static QR
- `POST /v1/transaction/get-paging` — cron fallback for unmatched payments

## Error Codes to Know

| Code | Meaning |
|---|---|
| Tingee `97` | Bad HMAC signature (use SDK, don't hand-roll) |
| Tingee `90`/`91` | Timestamp too old/wrong format (UTC+7, `yyyyMMddHHmmssSSS`) |
| Haravan `401` | Token revoked — merchant must reinstall app |

## What NOT to Build (MVP Scope)

- Dynamic QR (`generate-dynamic-qr`) — use static for MVP
- Cron fallback reconciliation — add in phase 2
- Manual mismatch matching UI — mark as `mismatch`, fix in phase 2
- OAuth token refresh — Haravan tokens are long-lived
- Admin dashboard
- Refund flows

## Agent Working Rules

1. **Read specs before coding.** Always read `specs/product-spec.md` and `specs/implementation-plan.md` before starting any implementation work.

2. **One phase at a time.** Implement only the phase or task requested. Do not jump ahead.

3. **Keep it simple.** No extra libraries, no extra abstractions, no features beyond what the current phase requires.

4. **Do not change the architecture.** Follow the file map above exactly. Only deviate if `specs/implementation-plan.md` is updated first.

5. **Update the change log after each phase.** Add an entry to `specs/change-log.md` describing what was implemented.

6. **Explain how to test after each phase.** After completing a phase, tell the user which command to run (`npm test`, `curl`, or browser step) to verify the work.
