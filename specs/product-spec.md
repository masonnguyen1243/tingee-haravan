# Product Spec — Tingee × Haravan QR Payment Integration

**Version:** 1.1  
**Date:** 2026-06-15  
**Status:** MVP

---

## 1. App Goal

Give Haravan merchants a way to accept VietQR bank transfers and have orders automatically marked as paid — without checking bank statements or calling customers.

The app sits between Haravan and Tingee: it shows customers a QR code at checkout, and when Tingee confirms the transfer, the app immediately updates the order on Haravan.

---

## 2. Target Users

| User | Who they are | What they want |
|---|---|---|
| **Merchant** | Haravan store owner | Set up once and never touch it again; orders confirm themselves |
| **Customer** | Buyer on the merchant's store | Scan a QR, pay, see confirmation — without waiting or calling anyone |

---

## 3. Core User Flow

### Merchant sets up (one time)

1. Merchant opens the app's setup page
2. Pastes their Haravan API token → app validates it
3. Enters Tingee Client ID + Secret Token → app fetches their bank accounts
4. Selects which bank account to receive payments
5. Adds "Chuyển khoản ngân hàng (QR)" as a manual payment method in Haravan Admin, with a link pointing to the app's payment page

### Customer pays

1. Customer places an order on Haravan and selects QR bank transfer
2. Haravan's payment instructions direct them to the app's payment page (e.g. `https://app.domain/pay?order_id=12345&amount=500000`)
3. Customer sees a QR code and a transfer note — scans with their banking app
4. Customer makes the transfer, keeping the transfer note unchanged
5. The page updates automatically when payment is confirmed — no refresh needed

### Payment is confirmed (automatic)

1. Customer's bank notifies Tingee
2. Tingee sends a payment notification (webhook) to the app
3. App verifies the notification is genuine, matches it to the correct order
4. App calls Haravan API to mark the order as paid
5. Customer's payment page shows a success message

---

## 4. Features in Scope

### F1 — Merchant Configuration

- Merchant enters their Haravan API token; app validates it against Haravan and saves it encrypted
- Merchant enters Tingee Client ID and Secret Token; app fetches their list of VA bank accounts
- Merchant selects one account as the default for receiving payments
- A 3-step setup wizard guides the merchant through the above
- Merchant can re-run setup to update any credential

### F2 — Customer QR Payment Page

- Accessible via URL containing the Haravan order ID and amount
- Displays the QR image, transfer amount, and transfer note (unique per order)
- Instructs customer to keep the transfer note unchanged
- Automatically polls for payment status and shows success when confirmed
- If the customer revisits the same order's payment page, the existing QR is shown (not regenerated)

### F3 — Automatic Payment Confirmation

- Receives payment notifications from Tingee
- Verifies each notification is authentic before acting on it
- Ignores duplicate notifications for the same transfer (no double-processing)
- Matches the notification to the correct Haravan order using the transfer note
- Calls the Haravan API to mark the order as paid when transfer amount matches
- Flags the payment as a mismatch if the transfer amount doesn't match; does not mark the order paid
- Logs every notification received (for audit and troubleshooting)

### F4 — Configuration API

- Returns current setup status (which steps are complete) without exposing secrets
- Endpoints to save/update each configuration step

---

## 5. Features Out of Scope

| Feature | Why excluded |
|---|---|
| OAuth / Haravan App Store listing | Not needed — merchants supply their own Haravan token directly |
| Dynamic QR codes | Static QR + unique transfer note is sufficient for MVP |
| Cron-based fallback reconciliation | Add in phase 2 if webhook reliability proves to be an issue |
| Manual mismatch resolution UI | Mismatches are flagged in the database; handle via support in phase 2 |
| Refund flows | Out of scope for this release |
| Multi-merchant UI | Database supports it, but the UI and routing are single-merchant for MVP |
| Notification emails | Out of scope |
| Per-bank notification registration (register-notify) | Evaluate after testing with the merchant's specific bank |

---

## 6. Acceptance Criteria

**Setup**
- [ ] Merchant completes all 3 configuration steps in under 5 minutes
- [ ] If the Haravan token is invalid, setup shows a clear error and does not save the token
- [ ] If the Tingee credentials are wrong, setup shows a clear error and does not save them
- [ ] Saved tokens and secrets are never returned in any API response

**Payment page**
- [ ] QR page loads within 2 seconds when given a valid order ID
- [ ] QR image is visible and scannable
- [ ] Transfer note displayed on the page matches the note embedded in the QR
- [ ] If the customer revisits the payment URL for the same order, the same QR is shown

**Automatic confirmation**
- [ ] A valid, matched payment causes the Haravan order to be marked paid within 5 seconds of webhook receipt
- [ ] The customer's payment page shows a success message once the order is confirmed
- [ ] A notification with an invalid signature is silently ignored — no error, no order update
- [ ] Sending the same notification twice does not create a duplicate transaction on Haravan
- [ ] A transfer with the wrong amount does not mark the order paid; payment is flagged as mismatch
- [ ] Every notification received is logged, whether matched or not
