# Test Plan — Tingee × Haravan Integration

**Version:** 1.0  
**Date:** 2026-06-15

---

## 1. Testing Philosophy

- **Test behavior, not implementation.** Tests assert what the system does (e.g., "payment gets marked paid"), not how it does it (e.g., "db.prepare was called").
- **No real network calls in unit/integration tests.** Mock `fetch` and `@tingee/sdk-node` at the module boundary.
- **Use real SQLite (`:memory:`) in route tests**, not a mocked DB — it's fast and catches schema issues.
- **Always test the security-critical paths** (signature verification, token encryption, idempotency) even when they feel boilerplate.

---

## 2. Test Layers

### 2.1 Unit Tests — `tests/utils/`

Pure functions, no I/O, no DB.

| File | What to test |
|---|---|
| `crypto.test.js` | Encrypt/decrypt round-trip, random IV uniqueness, tamper detection |
| `reconcile.test.js` | Format regex, uniqueness across 1000 calls |

**Run:** `npx jest tests/utils/`

### 2.2 Service Tests — `tests/services/`

Mock `fetch` (global) and `@tingee/sdk-node`. No DB.

| File | What to test |
|---|---|
| `haravan.test.js` | `validateToken` happy path and 401, `getOrder` fetch URL, `markOrderPaid` request body |
| `tingee.test.js` | `getVaList` returns items, throws on non-00, `generateQR` passes correct fields to SDK |

**Run:** `npx jest tests/services/`

### 2.3 Route/Integration Tests — `tests/routes/`

Use Supertest + in-memory SQLite. Mock service modules with Jest.

| File | What to test |
|---|---|
| `config.test.js` | Full config flow: Haravan → Tingee → account; GET /api/config status |
| `payment.test.js` | Create payment returns QR; idempotency for same orderId; status polling; 404 for unknown code |
| `webhook.test.js` | Valid sig marks paid; invalid sig rejected; duplicate idempotency; amount mismatch |

**Run:** `npx jest tests/routes/`

### 2.4 Manual Tests

Tests that require a browser or live credentials. Not automated.

| Scenario | How to test |
|---|---|
| Config wizard renders correctly | Open http://localhost:3000; complete all 3 steps |
| QR page renders QR image | `GET /pay?order_id=X&amount=Y`; verify QR visible |
| Poll loop shows success | Simulate paid status via direct DB update; verify page updates within 3s |

---

## 3. Test Cases by Feature

### 3.1 Crypto Utility

| # | Test | Expected |
|---|---|---|
| C1 | `encrypt('secret', KEY)` returns a string | Non-empty string, not equal to `'secret'` |
| C2 | `decrypt(encrypt(text, KEY), KEY)` round-trip | Returns original text |
| C3 | Two calls to `encrypt` with same input differ | Different ciphertext (random IV) |
| C4 | `decrypt` on tampered ciphertext | Throws (GCM auth tag mismatch) |

### 3.2 Reconcile Code Generator

| # | Test | Expected |
|---|---|---|
| R1 | Single code format | Matches `/^TG[A-Z0-9]{7}$/` |
| R2 | 1000 codes generated | All unique (Set size === 1000) |

### 3.3 Haravan Service

| # | Test | Expected |
|---|---|---|
| H1 | `validateToken` with mocked 200 | Returns shop data |
| H2 | `validateToken` with mocked 401 | Throws with "401" in message |
| H3 | `getOrder` calls correct URL | `GET /com/orders/12345.json` with Bearer auth |
| H4 | `markOrderPaid` sends correct body | POST with `{transaction:{kind:"Capture",amount:500000}}` |
| H5 | `markOrderPaid` on non-200 | Throws |

### 3.4 Tingee Service

| # | Test | Expected |
|---|---|---|
| T1 | `getVaList` returns items array | Items from SDK response |
| T2 | `getVaList` on code !== "00" | Throws |
| T3 | `generateQR` passes content field | SDK called with `content = reconcileCode` |
| T4 | `generateQR` returns `qrCode` and `qrCodeImage` | Both fields present |

### 3.5 Config Routes

| # | Test | Expected |
|---|---|---|
| CF1 | `GET /api/config` with empty DB | `{haravanConfigured:false, tingeeConfigured:false, accountSelected:false}` |
| CF2 | `POST /api/config/haravan` with valid data | 200 `{ok:true}` |
| CF3 | `POST /api/config/haravan` missing `apiToken` | 400 |
| CF4 | `POST /api/config/haravan` with Haravan returning 401 | 400 with error message |
| CF5 | `POST /api/config/tingee` returns account list | 200 with `accounts` array |
| CF6 | `POST /api/config/tingee` without Haravan set up | 400 "Configure Haravan first" |
| CF7 | `POST /api/config/account` saves default account | 200 `{ok:true}` |
| CF8 | `GET /api/config` after full setup | All three flags `true` |
| CF9 | API response never includes raw token | `api_token_enc` and `secret_enc` not in any response body |

### 3.6 Payment Routes

| # | Test | Expected |
|---|---|---|
| P1 | `POST /api/payments` creates pending payment | 201 with `reconcileCode`, `qrCodeImage`, `status:"pending"` |
| P2 | `POST /api/payments` reconcileCode matches `TG[A-Z0-9]{7}` | Format valid |
| P3 | `POST /api/payments` with same orderId twice | Same reconcileCode returned |
| P4 | `GET /api/payments/:code/status` for pending | `{status:"pending"}` |
| P5 | `GET /api/payments/UNKNOWN/status` | 404 |
| P6 | `POST /api/payments` when not configured | 503 |

### 3.7 Webhook Handler

| # | Test | Expected |
|---|---|---|
| W1 | Valid signature + matching reconcile code + correct amount | Payment marked `paid`, Haravan called, 200 `{code:"00"}` |
| W2 | Invalid `x-signature` | 200 `{code:"00"}` returned; payment status unchanged |
| W3 | Same `transactionCode` sent twice | Haravan `markOrderPaid` called exactly once |
| W4 | `content` field has no TG-pattern | 200 returned; no payment updated |
| W5 | Amount in IPN differs from `payments.amount` | Payment set to `mismatch`; Haravan NOT called |
| W6 | All IPN payloads logged to `webhook_events` | Row exists for every incoming IPN |
| W7 | Unmatched IPN (no reconcile code found) | `webhook_events` row with `matched_payment_id = NULL` |

---

## 4. Security Tests

| # | Scenario | Expected |
|---|---|---|
| S1 | Webhook with forged signature | Silently rejected, 200 returned (no 4xx that reveals system info) |
| S2 | `GET /api/config` | Never returns `api_token_enc` or `secret_enc` fields |
| S3 | Webhook body tampered after signature computed | Auth tag mismatch → rejected |
| S4 | Two orders with same amount, different reconcile codes | Only the matching code's order updated |
| S5 | Reconcile code reuse attempted (DB UNIQUE constraint) | INSERT fails; code guaranteed unique |

---

## 5. What We Do NOT Test (and Why)

| Excluded | Reason |
|---|---|
| Real Tingee API calls | Requires live credentials; covered by UAT phase |
| Real Haravan API calls | Same; mock is sufficient for unit correctness |
| ngrok tunnel | Infrastructure concern, not app logic |
| Browser rendering of QR image | Manual test only; jest-dom adds complexity without value here |
| SQLite file permissions | Environment concern, not app logic |

---

## 6. Running the Full Test Suite

```bash
# All tests
npx jest --runInBand

# Watch mode during development
npx jest --watch

# Single file
npx jest tests/routes/webhook.test.js

# With coverage
npx jest --coverage
```

Target: all unit + service + route tests pass before any deployment.

---

## 7. UAT (User Acceptance Testing) — Pre-Production Checklist

Run these against Tingee UAT environment with a real Haravan dev shop.

- [ ] Complete 3-step merchant config with real Tingee credentials
- [ ] Verify `GET /api/config` returns all three flags `true`
- [ ] Open `/pay?order_id=<real_id>&amount=<real_amount>` — QR renders
- [ ] Scan QR with banking app, make transfer to UAT account
- [ ] Verify Haravan order moves to "Đã thanh toán" within 10 seconds
- [ ] Verify payment page shows success message
- [ ] Check `webhook_events` table has the IPN record
- [ ] Send duplicate webhook (replay) — confirm Haravan not called twice
- [ ] Send webhook with wrong amount — confirm order NOT marked paid; `status = mismatch`
- [ ] Revoke Haravan token → verify app returns 400 on next config validation
- [ ] Switch to PROD Tingee credentials; repeat the full flow
