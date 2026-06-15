import { Router } from 'express';
import db from '../db';
import { encrypt, decrypt } from '../utils/crypto';
import { validateToken } from '../services/haravan';
import { getVaList } from '../services/tingee';

const router = Router();

router.get('/', (_req, res) => {
  const merchant = db
    .prepare('SELECT id, shop_domain FROM merchants LIMIT 1')
    .get() as { id: number; shop_domain: string } | undefined;

  const haravanConfigured = !!merchant;
  let tingeeConfigured = false;
  let accountSelected = false;
  let shopDomain: string | null = null;
  let selectedAccount: { accountNumber: string; bankBin: string; bankName: string } | null = null;

  if (merchant) {
    shopDomain = merchant.shop_domain;

    const tc = db.prepare('SELECT id FROM tingee_configs WHERE merchant_id = ?').get(merchant.id);
    tingeeConfigured = !!tc;

    const ta = db
      .prepare('SELECT account_number, bank_bin, bank_name FROM tingee_accounts WHERE merchant_id = ? AND is_default = 1')
      .get(merchant.id) as { account_number: string; bank_bin: string; bank_name: string } | undefined;
    accountSelected = !!ta;
    if (ta) {
      selectedAccount = { accountNumber: ta.account_number, bankBin: ta.bank_bin, bankName: ta.bank_name };
    }
  }

  res.json({ haravanConfigured, tingeeConfigured, accountSelected, shopDomain, selectedAccount });
});

router.get('/accounts', async (_req, res) => {
  const merchant = db.prepare('SELECT id FROM merchants LIMIT 1').get() as { id: number } | undefined;
  if (!merchant) return res.status(400).json({ error: 'Haravan not configured' });

  const tc = db
    .prepare('SELECT client_id_enc, secret_enc FROM tingee_configs WHERE merchant_id = ?')
    .get(merchant.id) as { client_id_enc: string; secret_enc: string } | undefined;
  if (!tc) return res.status(400).json({ error: 'Tingee not configured' });

  const key = process.env.ENCRYPTION_KEY!;
  try {
    const clientId = decrypt(tc.client_id_enc, key);
    const secretToken = decrypt(tc.secret_enc, key);
    const accounts = await getVaList(clientId, secretToken);
    return res.json({ accounts });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/haravan', async (req, res) => {
  const { shopDomain, apiToken } = req.body as { shopDomain?: string; apiToken?: string };

  if (!shopDomain || !apiToken) {
    return res.status(400).json({ error: 'shopDomain and apiToken are required' });
  }

  try {
    await validateToken(apiToken);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  const tokenEnc = encrypt(apiToken, process.env.ENCRYPTION_KEY!);

  db.prepare(
    `INSERT INTO merchants (shop_domain, api_token_enc) VALUES (?, ?)
     ON CONFLICT(shop_domain) DO UPDATE SET api_token_enc = excluded.api_token_enc, updated_at = datetime('now')`
  ).run(shopDomain, tokenEnc);

  return res.json({ ok: true });
});

router.post('/tingee', async (req, res) => {
  const { clientId, secretToken } = req.body as { clientId?: string; secretToken?: string };

  if (!clientId || !secretToken) {
    return res.status(400).json({ error: 'clientId and secretToken are required' });
  }

  let accounts: unknown[];
  try {
    accounts = await getVaList(clientId, secretToken);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  const merchant = db.prepare('SELECT id FROM merchants LIMIT 1').get() as { id: number } | undefined;
  if (!merchant) {
    return res.status(400).json({ error: 'Haravan not configured' });
  }

  const key = process.env.ENCRYPTION_KEY!;
  const clientIdEnc = encrypt(clientId, key);
  const secretEnc = encrypt(secretToken, key);

  const existing = db
    .prepare('SELECT id FROM tingee_configs WHERE merchant_id = ?')
    .get(merchant.id);

  if (existing) {
    db.prepare(
      `UPDATE tingee_configs SET client_id_enc = ?, secret_enc = ?, updated_at = datetime('now') WHERE merchant_id = ?`
    ).run(clientIdEnc, secretEnc, merchant.id);
  } else {
    db.prepare(
      'INSERT INTO tingee_configs (merchant_id, client_id_enc, secret_enc) VALUES (?, ?, ?)'
    ).run(merchant.id, clientIdEnc, secretEnc);
  }

  return res.json({ accounts });
});

router.post('/account', (req, res) => {
  const { accountNumber, bankBin, bankName } = req.body as {
    accountNumber?: string;
    bankBin?: string;
    bankName?: string;
  };

  if (!accountNumber || !bankBin) {
    return res.status(400).json({ error: 'accountNumber and bankBin are required' });
  }

  const merchant = db.prepare('SELECT id FROM merchants LIMIT 1').get() as { id: number } | undefined;
  if (!merchant) {
    return res.status(400).json({ error: 'Haravan not configured' });
  }

  db.prepare('DELETE FROM tingee_accounts WHERE merchant_id = ?').run(merchant.id);

  db.prepare(
    'INSERT INTO tingee_accounts (merchant_id, account_number, bank_bin, bank_name, is_default) VALUES (?, ?, ?, ?, 1)'
  ).run(merchant.id, accountNumber, bankBin, bankName ?? null);

  return res.json({ ok: true });
});

export default router;
