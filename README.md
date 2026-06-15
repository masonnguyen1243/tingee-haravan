# Tingee × Haravan Payment Integration

Middleware that adds QR bank transfer (VietQR via Tingee) as a payment method to Haravan stores. When a customer chooses this method at checkout, they are redirected to an app-hosted payment page showing a QR code. When Tingee confirms the transfer, the app automatically marks the Haravan order as paid.

This follows the same pattern that SePay uses for Haravan, implemented with the Tingee Open API.

---

## How It Works

```
Customer picks "QR Transfer" at checkout
  → Haravan redirects to our payment page (/pay?order_id=...)
  → App generates reconcile code + calls Tingee generate-viet-qr
  → Customer scans QR, transfers money (keeps transfer note unchanged)
  → Tingee POSTs IPN webhook to /webhook/tingee
  → App verifies signature, matches reconcile code → order ID
  → App calls Haravan Transaction API to mark order paid
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework | Express.js |
| Database | SQLite (dev), PostgreSQL (production) |
| Tingee SDK | @tingee/sdk-node |
| Testing | Jest + Supertest |
| HTTP Client | Built-in `fetch` (Node 20+) |

---

## Prerequisites

- Node.js 20 LTS
- A Haravan store (Partner dev shop is fine for testing)
- A Tingee account with Client ID + Secret Token
- ngrok (for local webhook testing during development)

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env — see Environment Variables section below

# 3. Start the dev server
npm run dev

# 4. Expose webhook endpoint (separate terminal)
ngrok http 3000

# 5. Open http://localhost:3000 and complete merchant setup
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: 3000) |
| `DB_PATH` | No | SQLite file path (default: `./data/app.db`) |
| `ENCRYPTION_KEY` | **Yes** | 64-char hex string for AES-256 encryption |
| `NODE_ENV` | No | `development` or `production` |

Generate a secure encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Running Tests

```bash
npm test             # run all tests once
npm run test:watch   # watch mode
```

---

## Project Structure

```
src/
  app.js              Express app (routes, middleware)
  server.js           HTTP server entry point
  db/
    schema.js         Table CREATE statements
    index.js          DB connection and initialization
  services/
    haravan.js        Haravan REST API client
    tingee.js         Tingee API client (wraps SDK)
  routes/
    config.js         Merchant configuration endpoints
    payment.js        Payment creation and status polling
    webhook.js        Tingee IPN handler
    pages.js          HTML page serving
  utils/
    crypto.js         AES-256-GCM encrypt/decrypt
    reconcile.js      Unique reconcile code generator
public/
  setup.html          Merchant configuration UI
  pay.html            Customer QR payment page (loaded by pages.js)
tests/
  (mirrors src/ structure)
.env.example
```

---

## Merchant Setup Guide

### 1. Create a Haravan Private App

1. Haravan Admin → **Apps** → **Private Apps** → **Create Private App**
2. Name: "Tingee Payment" (or any name)
3. API Permissions → **Orders**: set to **Read and write**
4. Save → copy the **Token**

> Only the store owner can create Private Apps.

### 2. Get Tingee Credentials

1. Log in at `app.tingee.vn` → **Developers**
2. Copy your **Client ID** and **Secret Token**
3. Set Webhook URL → `https://your-domain.com/webhook/tingee`

### 3. Configure the App

1. Open `https://your-domain.com` → follow the 3-step setup
2. Paste your Haravan token, then Tingee credentials
3. Select the bank account (VA) to receive payments

### 4. Configure Haravan Payment Method

In Haravan Admin → Settings → Payments → Manual Payment Methods:

- **Name**: `Chuyển khoản ngân hàng (QR)`
- **Payment instructions**: Include payment page link:
  `Quét mã QR để thanh toán: https://your-domain.com/pay?order_id={ORDER_ID}`

> Ask Haravan support for the exact template variable syntax for order IDs in your plan.

---

## Key Constraints

- **Never reuse reconcile codes** — each order gets exactly one unique code
- **Always verify Tingee webhook signatures** — forged webhooks are the main fraud vector
- **Haravan tokens are encrypted at rest** — never log them
- **QR is static** — customers must keep the transfer note unchanged for auto-matching to work
- **Webhook URL must be HTTPS** — use ngrok for local development
