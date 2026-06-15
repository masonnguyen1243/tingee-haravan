# Product Spec — Tingee × Haravan QR Payment Integration

**Version:** 2.0
**Date:** 2026-06-15
**Status:** MVP — Public App

---

## 1. App Goal

Give Haravan merchants a way to accept VietQR bank transfers and have orders automatically marked as paid — without checking bank statements or calling customers.

The app is a **Haravan Public App** (listed on App Store). Merchants install it in one click via OAuth. The app then injects a payment redirect script into the storefront automatically. When a customer completes a bank transfer, Tingee notifies the app and it marks the Haravan order as paid with no human intervention.

---

## 2. Target Users

| User | Who they are | What they want |
|---|---|---|
| **Merchant** | Haravan store owner | Install once, never touch again; orders confirm themselves |
| **Customer** | Buyer on the merchant's store | Scan a QR, pay, see confirmation — without waiting or calling anyone |

---

## 3. Core User Flow

### Merchant installs (one time)

1. Merchant finds the app on Haravan App Store (or visits install URL)
2. Clicks **Install** → redirected to Haravan OAuth consent screen
3. Approves permissions (`read_orders`, `write_orders`) → redirected back to app's setup page
4. Enters Tingee Client ID + Secret Token → app fetches their bank accounts
5. Selects which bank account to receive payments
6. Done — the app automatically:
   - Stores the OAuth access token (encrypted)
   - Registers a Script Tag on the Haravan storefront
   - Shows the Tingee webhook URL to configure

### Customer pays

1. Customer places an order on Haravan and proceeds to checkout
2. On the order thank-you page, the injected script detects payment is pending
3. Script redirects customer to the app's payment page: `/pay?order_id=...&amount=...&shop=...`
4. Customer sees a QR code and a transfer note — scans with their banking app
5. Customer transfers money, keeping the transfer note unchanged
6. The payment page automatically updates when payment is confirmed — no refresh needed

### Payment is confirmed (automatic)

1. Customer's bank notifies Tingee
2. Tingee sends a payment notification (webhook) to `${APP_URL}/webhook/tingee`
3. App verifies the notification signature; looks up the merchant via the reconcile code
4. App calls the correct merchant's Haravan API to mark the order as paid
5. Customer's payment page shows a success message

---

## 4. Features in Scope

### F1 — OAuth App Install

- Merchant installs via standard Haravan OAuth flow — no token pasting
- App requests `read_orders` and `write_orders` scopes
- Access token stored encrypted per merchant
- Multiple merchants can install the same app; data is fully isolated
- Reinstalling the same shop updates the token (upsert, no duplicate)

### F2 — Script Tag Auto-Redirect

- After install, app registers a Script Tag via Haravan Script Tags API
- Script loads on every storefront page; activates only on the order thank-you page
- Reads `order_id` and `amount` from Haravan's storefront JS context
- If payment is pending (`amount > 0`), redirects customer to `/pay`
- Script is idempotent — does nothing if already on the pay page or payment is complete

### F3 — Customer QR Payment Page

- Accessible via `/pay?order_id=ORDER&amount=AMOUNT&shop=SHOP`
- Calls `POST /api/payments` to generate reconcile code and QR image via Tingee
- Displays QR image, transfer amount, and transfer note (unique per order)
- Warns customer to keep the transfer note unchanged
- Polls `GET /api/payments/:code/status` every 3 seconds
- Shows success when confirmed; shows mismatch warning if amount was wrong
- If customer revisits the same order's payment URL, existing QR is returned (idempotent)

### F4 — Automatic Payment Confirmation

- Receives Tingee IPN webhooks at `/webhook/tingee`
- Verifies HMAC-SHA512 signature before acting
- Idempotency: duplicate `transactionCode` → return 200 immediately, no side effects
- Matches transfer note to reconcile code → order → merchant
- Calls the correct merchant's Haravan API to mark order paid when amount matches
- Flags as `mismatch` if amount doesn't match; does not mark order paid
- Logs every webhook event (for audit and troubleshooting)

### F5 — Post-Install Tingee Setup

- 2-step setup wizard (Step 1: Tingee credentials, Step 2: account selection)
- Displays webhook URL for merchant to configure in Tingee Developers portal
- Merchant can re-run setup to update Tingee credentials or change account

---

## 5. Features Out of Scope

| Feature | Why excluded |
|---|---|
| Dynamic QR codes | Static QR + unique transfer note is sufficient for MVP |
| Cron-based fallback reconciliation | Add in phase 2 if webhook reliability proves to be an issue |
| Manual mismatch resolution UI | Mismatches flagged in DB; handle via support in phase 2 |
| Refund flows | Out of scope for this release |
| Notification emails | Out of scope |
| OAuth token refresh | Haravan access tokens are long-lived; add refresh if needed post-launch |
| Per-bank notification registration | Evaluate after testing with merchant's specific bank |
| Admin dashboard for merchants | Phase 2 |

---

## 6. Acceptance Criteria

**Install and setup**
- [ ] Merchant completes OAuth install and 2-step Tingee setup in under 5 minutes
- [ ] If Tingee credentials are invalid, setup shows a clear error and does not save them
- [ ] Saved tokens and secrets are never returned in any API response
- [ ] Installing the same shop twice updates the record, not a duplicate
- [ ] Two different merchants install the app — their data is fully isolated

**Script Tag redirect**
- [ ] Script tag is registered on Haravan storefront immediately after OAuth callback
- [ ] Customer visiting order thank-you page with pending payment is redirected to `/pay`
- [ ] Customer visiting order thank-you page for a paid order is NOT redirected

**Payment page**
- [ ] QR page loads within 2 seconds when given valid `order_id`, `amount`, `shop`
- [ ] QR image is visible and scannable
- [ ] Transfer note displayed matches the note embedded in the QR
- [ ] Revisiting the same order's payment URL shows the same QR (not regenerated)

**Automatic confirmation**
- [ ] A valid matched payment marks the Haravan order paid within 5 seconds of webhook receipt
- [ ] Customer's pay page shows success message once confirmed
- [ ] Invalid signature → silently ignored, 200 returned, order unchanged
- [ ] Duplicate webhook → no second Haravan transaction created
- [ ] Wrong amount → order NOT marked paid; status = `mismatch`
- [ ] Every IPN logged to `webhook_events` whether matched or not
