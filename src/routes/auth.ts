import { Router } from 'express';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import db from '../db';
import { encrypt } from '../utils/crypto';
import { registerScriptTag } from '../services/haravan';

const router = Router();

const HARAVAN_API_KEY = () => process.env.HARAVAN_API_KEY!;
const HARAVAN_API_SECRET = () => process.env.HARAVAN_API_SECRET!;
const APP_URL = () => process.env.APP_URL!;

function isValidShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9-]+\.myharavan\.com$/.test(shop);
}

function verifyHaravanHmac(query: Record<string, string>, secret: string): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');
  const expected = createHmac('sha256', secret).update(message).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
  } catch {
    return false;
  }
}

router.get('/haravan', (req, res) => {
  const shop = req.query.shop as string | undefined;

  if (!shop) {
    return res.status(400).json({ error: 'shop is required' });
  }
  if (!isValidShopDomain(shop)) {
    return res.status(400).json({ error: 'Invalid shop domain. Must be *.myharavan.com' });
  }

  const state = randomBytes(16).toString('hex');
  db.prepare('INSERT INTO oauth_states (state, shop, created_at) VALUES (?, ?, ?)').run(
    state,
    shop,
    Date.now()
  );

  const redirectUri = encodeURIComponent(`${APP_URL()}/auth/haravan/callback`);
  const scope = 'read_orders,write_orders';
  const authUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${HARAVAN_API_KEY()}` +
    `&scope=${scope}` +
    `&redirect_uri=${redirectUri}` +
    `&state=${state}`;

  return res.redirect(authUrl);
});

router.get('/haravan/callback', async (req, res) => {
  const query = req.query as Record<string, string>;
  const { code, shop, state } = query;

  if (!code || !shop || !state) {
    return res.status(400).json({ error: 'Missing required OAuth callback params' });
  }

  // Verify state nonce (CSRF)
  const savedState = db
    .prepare('SELECT shop FROM oauth_states WHERE state = ?')
    .get(state) as { shop: string } | undefined;

  if (!savedState) {
    return res.status(400).json({ error: 'Invalid or expired state' });
  }
  if (savedState.shop !== shop) {
    db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
    return res.status(400).json({ error: 'State shop mismatch' });
  }

  // Delete state — single use
  db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);

  // Verify Haravan HMAC
  if (!verifyHaravanHmac(query, HARAVAN_API_SECRET())) {
    return res.status(400).json({ error: 'Invalid HMAC' });
  }

  // Exchange code for access token
  let accessToken: string;
  let scope: string;
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: HARAVAN_API_KEY(),
        client_secret: HARAVAN_API_SECRET(),
        code,
      }),
    });
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
    const tokenData = await tokenRes.json() as { access_token: string; scope: string };
    accessToken = tokenData.access_token;
    scope = tokenData.scope;
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  // Encrypt and upsert merchant
  const accessTokenEnc = encrypt(accessToken, process.env.ENCRYPTION_KEY!);
  db.prepare(
    `INSERT INTO merchants (shop_domain, access_token_enc, scope, installed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(shop_domain) DO UPDATE SET
       access_token_enc = excluded.access_token_enc,
       scope = excluded.scope,
       installed_at = excluded.installed_at,
       updated_at = datetime('now')`
  ).run(shop, accessTokenEnc, scope, Date.now());

  // Register Script Tag on the merchant's storefront
  try {
    await registerScriptTag(accessToken, `${APP_URL()}/payment-redirect.js`);
  } catch {
    // Non-fatal: log but proceed so merchant can still use setup
  }

  return res.redirect(`${APP_URL()}/setup?shop=${shop}`);
});

export default router;
