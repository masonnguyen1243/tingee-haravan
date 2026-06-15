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
