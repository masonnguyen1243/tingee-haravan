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
