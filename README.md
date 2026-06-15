# Tingee × Haravan Payment Integration

A Haravan **Public App** that adds VietQR bank transfer (via Tingee Open API) as a payment method. Merchants install in one click via OAuth. A Script Tag is automatically injected into the storefront to redirect customers to the payment page. When a transfer is confirmed by Tingee, the order is automatically marked paid on Haravan.

---

## How It Works

```
Merchant installs app (OAuth)
  → App gets access token + registers Script Tag on storefront

Customer places order → reaches thank-you page
  → Script Tag detects pending payment
  → Redirects to /pay?order_id=...&amount=...&shop=...
  → App generates reconcile code + calls Tingee generate-viet-qr
  → Customer scans QR, transfers money (keeps transfer note unchanged)

Tingee sends IPN webhook → /webhook/tingee
  → App verifies signature, matches reconcile code → order → merchant
  → App calls Haravan Transaction API → order marked paid
  → Customer's pay page shows success
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework | Express.js + TypeScript 5 |
| Database | SQLite (dev), PostgreSQL (production) |
| Tingee SDK | @tingee/sdk-node |
| Testing | Jest + ts-jest + Supertest |
| HTTP Client | Built-in `fetch` (Node 20+) |

---

## Prerequisites

- Node.js 20 LTS
- Haravan Partner account at `partners.haravan.com` — to get API Key and Secret
- A Tingee account with Client ID + Secret Token
- ngrok (for local webhook and OAuth testing)

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: 3000) |
| `DB_PATH` | No | SQLite file path (default: `./data/app.db`) |
| `ENCRYPTION_KEY` | **Yes** | 64-char hex string for AES-256 encryption |
| `HARAVAN_API_KEY` | **Yes** | Haravan App Client ID (from partners.haravan.com) |
| `HARAVAN_API_SECRET` | **Yes** | Haravan App Client Secret |
| `APP_URL` | **Yes** | Public HTTPS URL of this app (e.g. `https://your-app.railway.app`) |
| `NODE_ENV` | No | `development` or `production` |

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env — fill in ENCRYPTION_KEY, HARAVAN_API_KEY, HARAVAN_API_SECRET

# 3. Expose to internet (OAuth and webhooks require HTTPS)
ngrok http 3000
# Copy the HTTPS URL (e.g. https://abc123.ngrok.io)
# Paste it into .env as APP_URL

# 4. Start the dev server
npm run dev
```

---

## Running Tests

```bash
npm test             # run all tests once
npm test -- --watch  # watch mode
```

---

## Merchant Install Flow

### 1. Register a Haravan Partner App

1. Go to `partners.haravan.com` → Apps → Create App
2. Set OAuth redirect URI to `${APP_URL}/auth/haravan/callback`
3. Set required scopes: `read_orders`, `write_orders`
4. Copy Client ID → `HARAVAN_API_KEY` in `.env`
5. Copy Client Secret → `HARAVAN_API_SECRET` in `.env`

### 2. Install the App

1. Open `${APP_URL}/install`
2. Enter your Haravan shop domain (e.g. `your-store.myharavan.com`)
3. Click **Install** → approve permissions on Haravan
4. You're redirected to the setup page

### 3. Configure Tingee

1. Log in at `app.tingee.vn` → Developers → copy Client ID and Secret Token
2. Enter them in the setup page → your bank accounts are fetched
3. Select the account to receive payments
4. Copy the **Webhook URL** shown and paste it into Tingee Developers → Webhook URL

### 4. Done

The Script Tag is registered automatically after install. Customers who place orders and reach the thank-you page are redirected to the payment QR page automatically.

---

## Project Structure

```
src/
  app.ts              Express app (routes, middleware)
  server.ts           HTTP server entry point
  db/
    schema.ts         Table CREATE statements (6 tables)
    index.ts          DB connection and initialization
  services/
    haravan.ts        Haravan REST API client
    tingee.ts         Tingee API client (wraps SDK)
  routes/
    auth.ts           OAuth install flow
    config.ts         Tingee configuration endpoints (shop-scoped)
    payment.ts        Payment creation and status polling
    webhook.ts        Tingee IPN handler
    pages.ts          HTML page serving
  utils/
    crypto.ts         AES-256-GCM encrypt/decrypt
    reconcile.ts      Unique reconcile code generator
public/
  install.html        Merchant install landing page
  setup.html          2-step Tingee configuration UI
  pay.html            Customer QR payment page
  payment-redirect.js Script injected into Haravan storefront
tests/
  (mirrors src/ structure)
.env.example
```

---

## Key Constraints

- **Never reuse reconcile codes** — each order gets exactly one unique code
- **Always verify Tingee webhook signatures** — forged webhooks are the main fraud vector
- **Access tokens are encrypted at rest** — never log them
- **QR is static** — customers must keep the transfer note unchanged for auto-matching to work
- **Webhook URL must be HTTPS** — use ngrok for local development
- **All config/payment routes are shop-scoped** — always pass `?shop=` param
- **OAuth state is single-use** — prevents CSRF attacks

---

## Multi-tenant

One deployment serves many merchants. Each merchant's data (tokens, Tingee config, payments) is isolated by `merchant_id` in the database. The webhook handler identifies the correct merchant via `reconcile_code → payment → merchant_id`.
