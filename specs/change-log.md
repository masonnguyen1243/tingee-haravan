# Change Log

All notable changes to this project are documented here.  
Format: `[version] YYYY-MM-DD — Summary`

---

## [0.1.0] 2026-06-15 — Initial spec

- Created README.md, CLAUDE.md
- Defined product spec (specs/product-spec.md)
- Defined implementation plan with 13 TDD tasks (specs/implementation-plan.md)
- Defined test plan covering unit, service, route, security, and UAT (specs/test-plan.md)
- Architecture: Private App + static token (no OAuth), static VietQR, intermediate payment page

---

## [0.5.0] 2026-06-15 — Phase 4 (Config routes): merchant and Tingee configuration API

- Created `src/routes/config.ts` — four endpoints:
  - `GET /api/config` → `{ haravanConfigured, tingeeConfigured, accountSelected }` (booleans only, no raw tokens)
  - `POST /api/config/haravan` → validates token via Haravan, encrypts with AES-256-GCM, upserts `merchants`; returns `{ ok: true }`
  - `POST /api/config/tingee` → fetches VA list via Tingee SDK, encrypts credentials, upserts `tingee_configs`; returns `{ accounts: [...] }`
  - `POST /api/config/account` → clears existing default in `tingee_accounts`, inserts new row with `is_default = 1`; returns `{ ok: true }`
- Created `tests/routes/config.test.ts` — 19 tests using Supertest + in-memory SQLite:
  - `GET /api/config` before/after each step, raw token exclusion check
  - `POST /api/config/haravan`: happy path, upsert idempotency, 401 rejection, missing fields
  - `POST /api/config/tingee`: happy path, DB persistence, update-on-second-call, SDK error, missing fields
  - `POST /api/config/account`: insert, default-clearing, missing fields
  - Full 3-step setup flow verifying config state after each step
- Verified: `npm test tests/routes/config.test.ts` → 19/19 tests pass

---

## [0.4.2] 2026-06-15 — Phase 3 (Services): Haravan and Tingee API wrappers

- Created `src/services/haravan.ts` — three functions using Node built-in `fetch`:
  - `validateToken(token)` → `GET /com/shop.json`; throws on non-200
  - `getOrder(token, orderId)` → `GET /com/orders/{id}.json`; returns `order` object; throws on non-200
  - `markOrderPaid(token, orderId, amount)` → `POST /com/orders/{id}/transactions.json` with `{ transaction: { kind: "Capture", amount } }`; throws on non-200
- Created `src/services/tingee.ts` — two functions via `@tingee/sdk-node`:
  - `getVaList(clientId, secretToken)` → `client.bank.getVaPaging(...)`; returns `items[]`; throws if `code !== "00"`
  - `generateQR(clientId, secretToken, opts)` → `client.bank.generateVietQr(...)`; returns `{ qrCode, qrCodeImage }`; throws if `code !== "00"`
- Created `tests/services/haravan.test.ts` — 6 tests: URL/body shape, happy path, 401/404/422 error paths
- Created `tests/services/tingee.test.ts` — 7 tests: items returned, pagination fields, `content` field passed, error code throws for both functions
- Verified: `npm test tests/services` → 13/13 tests pass

---

## [0.4.1] 2026-06-15 — Phase 3 (Utilities): crypto and reconcile code

- Created `src/utils/crypto.ts` — AES-256-GCM encryption helpers
  - `encrypt(text, keyHex)`: random 12-byte IV each call, returns `iv:tag:ciphertext` (all hex)
  - `decrypt(cipher, keyHex)`: verifies auth tag; throws on tampered data or wrong key
- Created `src/utils/reconcile.ts` — `generateReconcileCode()` returns `TG` + 7 random uppercase alphanumeric characters via `node:crypto`
- Created `tests/utils/crypto.test.ts` — 6 tests: round-trip, random IV, wrong key, tampered ciphertext, tampered tag, invalid format
- Created `tests/utils/reconcile.test.ts` — 3 tests: format regex, length 9, 1000 codes all unique
- Verified: `npm test tests/utils` → 9/9 tests pass

---

## [0.4.0] 2026-06-15 — Phase 3 (Database): Schema and DB connection

- Created `src/db/schema.ts` — `SQL_CREATE_TABLES` constant with `CREATE TABLE IF NOT EXISTS` for all 5 tables: `merchants`, `tingee_configs`, `tingee_accounts`, `payments`, `webhook_events`
  - `payments.reconcile_code` has a UNIQUE constraint
  - `tingee_configs` and `payments` have foreign keys referencing `merchants(id)`
- Created `src/db/index.ts` — opens `better-sqlite3` at `DB_PATH`, enables WAL mode and foreign keys, runs schema on startup, exports `db` singleton
- Created `tests/db/schema.test.ts` — 4 passing tests: all 5 tables exist, UNIQUE constraint on `reconcile_code`, idempotent double-init, FK enforcement on `tingee_configs`
- Verified: `npm test tests/db` → 4/4 tests pass

---

## [0.3.0] 2026-06-15 — Phase 2: Core UI

- Created `public/setup.html` — 3-step merchant config wizard (Haravan → Tingee → Account)
  - Steps 2 and 3 locked (greyed out, non-interactive) until previous step completes
  - Completed steps get green border and checkmark via `.done` CSS class
  - Inline validation: each button shows an error below if required fields are empty
  - Success banner appears after Step 3 is confirmed
  - Step 2 populates account dropdown with dummy data (replaced by API in Phase 4)
- Created `public/pay.html` — customer QR payment page
  - Loading spinner shown on initial load
  - Content area (amount, QR placeholder, transfer note, warning box) hidden until loaded
  - Three status states: pending (spinner), paid (green), mismatch (orange)
  - Error state shown if `order_id` is missing from URL
  - All state-switch functions exposed on `window` for DevTools testing: `showLoading()`, `showContent({amount, note})`, `showError(msg)`, `showStatus('pending'|'paid'|'mismatch')`
- No API calls in this phase — all interactions are client-side only
- Verified: 34/34 structural and logic checks pass

## [0.2.1] 2026-06-15 — Migrate Phase 1 to TypeScript

- Replaced `src/app.js` / `src/server.js` with `src/app.ts` / `src/server.ts`
- Added TypeScript dev deps: `typescript@^5.9.3`, `tsx`, `ts-jest`, `@types/node`, `@types/express`, `@types/better-sqlite3`, `@types/jest`, `@types/supertest`
- Created `tsconfig.json` — target ES2022, CommonJS, strict, outDir `dist/`
- Updated `package.json` scripts: `dev` → `tsx watch src/server.ts`, `build` → `tsc`, `start` → `node dist/server.js`
- Updated Jest preset from default to `ts-jest`; testMatch changed to `**/*.test.ts`
- Updated all file references in `CLAUDE.md` and `specs/implementation-plan.md` from `.js` to `.ts`
- Note: `@tingee/sdk-node` already ships its own TypeScript declarations — no stub needed
- Verified: `tsc --noEmit` passes; `npm run dev` starts; `curl localhost:3000/health` returns `{"status":"ok"}`

## [0.2.0] 2026-06-15 — Phase 1: Project Setup

- Created `package.json` with `start`, `dev` (node --watch), and `test` (jest --runInBand) scripts
- Added dependencies: `express`, `better-sqlite3`, `@tingee/sdk-node@^0.2.3`, `dotenv`
- Added dev dependencies: `jest`, `supertest`
- Ran `npm install` — 391 packages, 0 vulnerabilities
- Created `.env.example` with `PORT`, `DB_PATH`, `ENCRYPTION_KEY`, `NODE_ENV`
- Created full folder structure: `src/db/`, `src/services/`, `src/routes/`, `src/utils/`, `public/`, `tests/utils/`, `tests/services/`, `tests/routes/`, `tests/db/`, `data/`
- Created `src/app.js` — Express instance, JSON middleware, static `/public`, `GET /health` → `{"status":"ok"}`
- Created `src/server.js` — loads `.env`, imports app, listens on `PORT`
- Created `.gitignore` — excludes `node_modules/`, `.env`, `data/*.db`
- Verified: `curl localhost:3000/health` returns `{"status":"ok"}`

<!-- Add entries here as features are implemented, changed, or fixed. -->
<!-- Format: ## [x.y.z] YYYY-MM-DD — Title -->
<!--   - What changed and why -->
