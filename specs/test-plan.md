# Test Plan — Tingee × Haravan Integration

**Version:** 2.0
**Date:** 2026-06-15

---

## 1. Testing Philosophy

- **Test behavior, not implementation.** Tests assert what the system does, not how it does it.
- **No real network calls in unit/integration tests.** Mock `fetch` and `@tingee/sdk-node` at the module boundary.
- **Use real SQLite (`:memory:`) in route tests**, not a mocked DB — fast and catches schema issues.
- **Always test security-critical paths** — signature verification, token encryption, OAuth state/HMAC, idempotency.

---

## 2. Test Layers

### 2.1 Unit Tests — `tests/utils/`

Pure functions, no I/O, no DB.

| File | What to test |
|---|---|
| `crypto.test.ts` | Encrypt/decrypt round-trip, random IV uniqueness, tamper detection |
| `reconcile.test.ts` | Format regex, uniqueness across 1000 calls |

**Run:** `npm test tests/utils`

### 2.2 Service Tests — `tests/services/`

Mock `fetch` (global) and `@tingee/sdk-node`. No DB.

| File | What to test |
|---|---|
| `haravan.test.ts` | `getShop` happy path and 401, `getOrder` fetch URL, `markOrderPaid` request body, `registerScriptTag` request shape |
| `tingee.test.ts` | `getVaList` returns items, throws on non-00; `generateQR` passes correct fields; both throw on error codes |

**Run:** `npm test tests/services`

### 2.3 Route/Integration Tests — `tests/routes/`

Use Supertest + in-memory SQLite. Mock service modules with Jest.

| File | What to test |
|---|---|
| `auth.test.ts` | OAuth redirect URL, state CSRF, callback token exchange, HMAC verification, invalid flows |
| `config.test.ts` | Tingee setup flow (shop-scoped); GET /api/config before and after; raw token exclusion |
| `payment.test.ts` | Create payment, idempotency, status polling, 404, missing shop |
| `webhook.test.ts` | Valid sig + match, invalid sig, duplicate, amount mismatch, multi-merchant routing |

**Run:** `npm test tests/routes`

### 2.4 Manual Tests

| Scenario | How to test |
|---|---|
| OAuth install flow | Open `/install`, enter shop domain, click Install, complete OAuth, verify redirect to setup |
| Script tag redirect | Place test order on dev store, visit thank-you page, confirm redirect to `/pay` |
| QR renders | `/pay?order_id=X&amount=Y&shop=Z` — verify QR visible and scannable |
| Poll shows success | Simulate paid status via direct DB update; verify page updates within 3s |
| Two merchants isolated | Install two shops, verify each only sees their own payments |

---

## 3. Test Cases by Feature

### 3.1 Crypto Utility

| # | Test | Expected |
|---|---|---|
| C1 | `encrypt('secret', KEY)` | Non-empty string, not equal to `'secret'` |
| C2 | `decrypt(encrypt(text, KEY), KEY)` | Returns original text |
| C3 | Two calls to `encrypt` with same input | Different ciphertext (random IV) |
| C4 | `decrypt` on tampered ciphertext | Throws |
| C5 | `decrypt` with wrong key | Throws |

### 3.2 Reconcile Code Generator

| # | Test | Expected |
|---|---|---|
| R1 | Single code format | Matches `/^TG[A-Z0-9]{7}$/` |
| R2 | 1000 codes generated | All unique (Set size === 1000) |

### 3.3 Haravan Service

| # | Test | Expected |
|---|---|---|
| H1 | `getShop` with mocked 200 | Returns shop data |
| H2 | `getShop` with mocked 401 | Throws with "401" in message |
| H3 | `getOrder` calls correct URL | `GET /com/orders/12345.json` with Bearer auth |
| H4 | `markOrderPaid` sends correct body | POST with `{transaction:{kind:"Capture",amount:500000}}` |
| H5 | `markOrderPaid` on non-200 | Throws |
| H6 | `registerScriptTag` sends correct body | POST to `/com/script_tags.json` with `{script_tag:{event:"onload",src:URL}}` |
| H7 | `registerScriptTag` on non-200 | Throws |

### 3.4 Tingee Service

| # | Test | Expected |
|---|---|---|
| T1 | `getVaList` returns items array | Items from SDK response |
| T2 | `getVaList` on code !== "00" | Throws |
| T3 | `generateQR` passes content field | SDK called with `content = reconcileCode` |
| T4 | `generateQR` returns `qrCode` and `qrCodeImage` | Both fields present |
| T5 | `generateQR` on code !== "00" | Throws |

### 3.5 Auth Routes (OAuth)

| # | Test | Expected |
|---|---|---|
| A1 | `GET /auth/haravan` without `shop` param | 400 |
| A2 | `GET /auth/haravan?shop=invalid` (bad format) | 400 |
| A3 | `GET /auth/haravan?shop=valid.myharavan.com` | 302 redirect to Haravan OAuth URL; state saved in `oauth_states` |
| A4 | OAuth redirect URL contains correct `client_id`, `scope`, `redirect_uri`, `state` | Verified via redirect URL params |
| A5 | `GET /auth/haravan/callback` with unknown state | 400 |
| A6 | `GET /auth/haravan/callback` with wrong shop for state | 400 |
| A7 | `GET /auth/haravan/callback` with invalid HMAC | 400 |
| A8 | `GET /auth/haravan/callback` valid | 302 to `/setup?shop=...`; merchant upserted in DB; `registerScriptTag` called; state deleted |
| A9 | State nonce is single-use | Second callback with same state → 400 |
| A10 | Reinstall same shop | Merchant updated (upsert), not duplicate |

### 3.6 Config Routes

| # | Test | Expected |
|---|---|---|
| CF1 | `GET /api/config?shop=SHOP` with fresh merchant | `{tingeeConfigured:false, accountSelected:false}` |
| CF2 | `POST /api/config/tingee?shop=SHOP` with valid creds | 200 `{accounts:[...]}` |
| CF3 | `POST /api/config/tingee?shop=SHOP` missing fields | 400 |
| CF4 | `POST /api/config/tingee?shop=SHOP` Tingee rejects creds | 400 with error message |
| CF5 | `POST /api/config/tingee?shop=UNKNOWN` (not installed) | 404 |
| CF6 | `POST /api/config/account?shop=SHOP` saves default | 200 `{ok:true}` |
| CF7 | `POST /api/config/account?shop=SHOP` missing fields | 400 |
| CF8 | `GET /api/config?shop=SHOP` after full setup | `{tingeeConfigured:true, accountSelected:true}` |
| CF9 | API response never includes raw token or encrypted fields | `access_token_enc`, `secret_enc` not in any response |
| CF10 | shopA config not visible via shopB's shop param | Isolation verified |

### 3.7 Payment Routes

| # | Test | Expected |
|---|---|---|
| P1 | `POST /api/payments` with valid shop + orderId + amount | 200 with `reconcileCode`, `qrCodeImage`, `status:"pending"` |
| P2 | Reconcile code format | Matches `/^TG[A-Z0-9]{7}$/` |
| P3 | Same orderId + shop twice (pending) | Same reconcileCode returned; `generateQR` not called again |
| P4 | Same orderId + shop when payment is `paid` | New payment created |
| P5 | `GET /api/payments/:code/status` for pending | `{status:"pending"}` |
| P6 | `GET /api/payments/UNKNOWN/status` | 404 |
| P7 | `POST /api/payments` missing `shop` | 400 |
| P8 | `POST /api/payments` missing `orderId` or `amount` | 400 |
| P9 | `POST /api/payments` shop not installed | 404 |
| P10 | `POST /api/payments` shop not fully configured | 503 |

### 3.8 Webhook Handler

| # | Test | Expected |
|---|---|---|
| W1 | Valid signature + matching reconcile code + correct amount | Payment `paid`; Haravan called; 200 `{code:"00"}` |
| W2 | Invalid `x-signature` | 200 `{code:"00"}`; payment status unchanged; event logged with `signature_valid=0` |
| W3 | Missing signature header | 200 `{code:"00"}`; treated as invalid |
| W4 | Same `transactionCode` sent twice | `markOrderPaid` called exactly once; second IPN returns 200 without processing |
| W5 | `content` has no TG-pattern | 200 returned; no payment updated |
| W6 | Amount in IPN differs from `payments.amount` | Status = `mismatch`; Haravan NOT called |
| W7 | All valid IPNs logged with `signature_valid=1` | Row in `webhook_events` for every IPN |
| W8 | Matched IPN has `matched_payment_id` set | FK references the correct payment row |
| W9 | Webhook routes to correct merchant | ShopA's webhook does not affect shopB's payments |

---

## 4. Security Tests

| # | Scenario | Expected |
|---|---|---|
| S1 | Webhook with forged signature | Silently rejected, 200 returned |
| S2 | `GET /api/config` | Never returns `access_token_enc` or `secret_enc` |
| S3 | Webhook body tampered after signature | Auth tag mismatch → rejected |
| S4 | Two orders same amount, different reconcile codes | Only matching code's order updated |
| S5 | Reconcile code reuse attempt | DB UNIQUE constraint fails; code guaranteed unique |
| S6 | OAuth callback with state from different shop | 400; no token stored |
| S6 | OAuth callback with forged Haravan HMAC | 400; no token stored |
| S7 | Config API called for uninstalled shop | 404; no data leaked |

---

## 5. What We Do NOT Test (and Why)

| Excluded | Reason |
|---|---|
| Real Tingee API calls | Requires live credentials; covered by UAT |
| Real Haravan API calls | Same; mock is sufficient for unit correctness |
| Real OAuth flow end-to-end | Requires Haravan Partner credentials; covered by UAT |
| ngrok tunnel | Infrastructure concern |
| Browser rendering of QR image | Manual test only |
| SQLite file permissions | Environment concern |
| Script tag execution in browser | Manual test only; Haravan JS context not reproducible in Jest |

---

## 6. Running the Full Test Suite

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Single file
npm test tests/routes/auth.test.ts

# With coverage
npm test -- --coverage
```

Target: all unit + service + route tests pass before any deployment.

---

## 7. UAT (User Acceptance Testing) — Pre-Production Checklist

Run against Tingee UAT environment with a real Haravan dev shop.

- [ ] Install app via OAuth on dev store — redirected to setup page
- [ ] Complete 2-step Tingee setup
- [ ] Verify `GET /api/config?shop=...` returns `{tingeeConfigured:true, accountSelected:true}`
- [ ] Confirm script tag registered: Haravan Admin → Apps → Script Tags
- [ ] Place test order; visit thank-you page; confirm redirect to `/pay`
- [ ] QR renders; transfer note visible
- [ ] Make transfer via banking app (UAT); order moves to "Đã thanh toán" within 10s
- [ ] Pay page shows success
- [ ] Check `webhook_events` table: IPN logged with `matched_payment_id` set
- [ ] Send duplicate webhook → Haravan not called twice
- [ ] Send webhook with wrong amount → order NOT marked paid; `status = mismatch`
- [ ] Send forged signature → order unaffected
- [ ] Install second merchant → verify data isolation
- [ ] Reinstall same shop → no duplicate merchant row
