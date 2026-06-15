import { Router } from 'express';
import db from '../db';
import { encrypt, decrypt } from '../utils/crypto';
import { getVaList } from '../services/tingee';

const router = Router();

function getMerchantByShop(shop: string): { id: number; shop_domain: string } | undefined {
  return db
    .prepare('SELECT id, shop_domain FROM merchants WHERE shop_domain = ?')
    .get(shop) as { id: number; shop_domain: string } | undefined;
}

router.get('/', (req, res) => {
  const shop = req.query.shop as string | undefined;
  if (!shop) return res.status(400).json({ error: 'shop is required' });

  const merchant = getMerchantByShop(shop);
  if (!merchant) {
    return res.json({ tingeeConfigured: false, accountSelected: false, shopDomain: shop, selectedAccount: null });
  }

  const tc = db.prepare('SELECT id FROM tingee_configs WHERE merchant_id = ?').get(merchant.id);
  const tingeeConfigured = !!tc;

  const ta = db
    .prepare('SELECT account_number, bank_bin, bank_name FROM tingee_accounts WHERE merchant_id = ? AND is_default = 1')
    .get(merchant.id) as { account_number: string; bank_bin: string; bank_name: string } | undefined;
  const accountSelected = !!ta;
  const selectedAccount = ta
    ? { accountNumber: ta.account_number, bankBin: ta.bank_bin, bankName: ta.bank_name }
    : null;

  return res.json({ tingeeConfigured, accountSelected, shopDomain: shop, selectedAccount });
});

router.get('/accounts', async (req, res) => {
  const shop = req.query.shop as string | undefined;
  if (!shop) return res.status(400).json({ error: 'shop is required' });

  const merchant = getMerchantByShop(shop);
  if (!merchant) return res.status(404).json({ error: 'Shop not installed' });

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

router.post('/tingee', async (req, res) => {
  const shop = req.query.shop as string | undefined;
  if (!shop) return res.status(400).json({ error: 'shop is required' });

  const merchant = getMerchantByShop(shop);
  if (!merchant) return res.status(404).json({ error: 'Shop not installed' });

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
  const shop = req.query.shop as string | undefined;
  if (!shop) return res.status(400).json({ error: 'shop is required' });

  const merchant = getMerchantByShop(shop);
  if (!merchant) return res.status(404).json({ error: 'Shop not installed' });

  const { accountNumber, bankBin, bankName } = req.body as {
    accountNumber?: string;
    bankBin?: string;
    bankName?: string;
  };

  if (!accountNumber || !bankBin) {
    return res.status(400).json({ error: 'accountNumber and bankBin are required' });
  }

  db.prepare('DELETE FROM tingee_accounts WHERE merchant_id = ?').run(merchant.id);
  db.prepare(
    'INSERT INTO tingee_accounts (merchant_id, account_number, bank_bin, bank_name, is_default) VALUES (?, ?, ?, ?, 1)'
  ).run(merchant.id, accountNumber, bankBin, bankName ?? null);

  return res.json({ ok: true });
});

export default router;
