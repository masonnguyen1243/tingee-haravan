# CLAUDE.md — Tingee × Haravan Integration

## What This Project Is

A Node.js middleware that connects Haravan (e-commerce platform) and Tingee (Open Banking API) to enable automatic QR payment confirmation. When a customer transfers money via VietQR, Tingee fires a webhook, the app matches the payment to the order, and marks it paid on Haravan — no human intervention needed.

Architecture model: **Private App + static API token** (not OAuth). Merchants manually create a Haravan Private App and paste the token into our config UI.

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
cp .env.example .env    # fill in ENCRYPTION_KEY
npm run dev             # starts on PORT (default 3000)
npm test                # run test suite
```

## Critical Rules — Never Break These

1. **Never reuse a reconcile code.** Each `payments` row gets one unique `reconcile_code`. `reconcile.ts` generates them; do not bypass it.

2. **Always verify Tingee webhook signatures.** `webhook.ts` must verify `x-signature = HMAC_SHA512(timestamp + ":" + JSON.stringify(body), secretToken)` before processing any IPN. Reject silently (return 200 `{code:"00"}`) on mismatch to prevent retry storms.

3. **Idempotency on `transactionCode`.** Check `webhook_events` for the `tingee_transaction_code` before processing. If already seen, return 200 immediately.

4. **Never log API tokens or Secret Tokens.** These are encrypted at rest using `crypto.ts`. Only decrypt immediately before use.

5. **Only mark an order paid when both reconcile code AND amount match.** Amount mismatch → set `status = 'mismatch'`, do not call Haravan.

6. **Use `accountNumber` (real account number) for QR generation**, not `vaAccountNumber`. They are different fields in the Tingee VA response.

## Project File Map

```
src/
  app.ts          Express setup: mounts all routes, parses JSON, serves /public
  server.ts       Calls app.ts and listens on PORT — only file that starts the server
  db/
    schema.ts     All CREATE TABLE IF NOT EXISTS statements (run on startup)
    index.ts      Opens better-sqlite3 connection, runs schema.ts, exports db
  services/
    haravan.ts    validateToken(token), getOrder(token, orderId), markOrderPaid(token, orderId, amount)
    tingee.ts     getVaList(clientId, secretToken), generateQR(clientId, secretToken, opts)
  routes/
    config.ts     POST /api/config/haravan, POST /api/config/tingee, POST /api/config/account, GET /api/config
    payment.ts    POST /api/payments, GET /api/payments/:reconcileCode/status
    webhook.ts    POST /webhook/tingee
    pages.ts      GET / (setup page), GET /pay (QR payment page)
  utils/
    crypto.ts     encrypt(text, keyHex), decrypt(cipher, keyHex) — AES-256-GCM
    reconcile.ts  generateReconcileCode() — returns "TG" + 7 alphanumeric chars
public/
  setup.html      Multi-step merchant config wizard
  pay.html        Customer QR payment page (polls /api/payments/:code/status)
tests/             Mirror of src/ — one test file per source file (.test.ts)
tsconfig.json     TypeScript compiler config (target ES2022, CommonJS, outDir dist/)
```

## Database Tables (summary)

| Table | Purpose |
|---|---|
| `merchants` | Haravan shop domain + encrypted API token |
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

## Haravan API

Base URL: `https://apis.haravan.com/com`
Auth header: `Authorization: Bearer {token}`

Key endpoints:
- `GET /shop.json` — validate token
- `GET /orders/{id}.json` — fetch order details
- `POST /orders/{id}/transactions.json` — body: `{"transaction":{"kind":"Capture","amount":NNN}}`

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
| Haravan `401` | Token revoked — prompt merchant to regenerate |

## What NOT to Build (MVP Scope)

- OAuth / App Store public listing
- Dynamic QR (`generate-dynamic-qr`) — use static for MVP
- Cron fallback reconciliation — add in phase 2
- Manual mismatch matching UI — mark as `mismatch`, fix in phase 2
- Multi-currency support
- Refund flows

## Agent Working Rules

1. **Read specs before coding.** Always read `specs/product-spec.md` and `specs/implementation-plan.md` before starting any implementation work.

2. **One phase at a time.** Implement only the phase or task requested. Do not jump ahead.

3. **Keep it simple.** No extra libraries, no extra abstractions, no features beyond what the current phase requires.

4. **Do not change the architecture.** Follow the file map above exactly. Only deviate if `specs/implementation-plan.md` is updated first.

5. **Update the change log after each phase.** Add an entry to `specs/change-log.md` describing what was implemented.

6. **Explain how to test after each phase.** After completing a phase, tell the user which command to run (`npm test`, `curl`, or browser step) to verify the work.
