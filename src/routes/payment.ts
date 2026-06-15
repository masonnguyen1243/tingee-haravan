import { Router } from 'express';
import db from '../db';
import { decrypt } from '../utils/crypto';
import { generateReconcileCode } from '../utils/reconcile';
import { generateQR } from '../services/tingee';

const router = Router();

interface PaymentRow {
  reconcile_code: string;
  amount: number;
  status: string;
  qr_code_image: string | null;
  paid_at: string | null;
}

router.post('/', async (req, res) => {
  const { orderId, amount } = req.body as { orderId?: string; amount?: number };

  if (!orderId || amount == null) {
    return res.status(400).json({ error: 'orderId and amount are required' });
  }

  const merchant = db.prepare('SELECT id FROM merchants LIMIT 1').get() as { id: number } | undefined;
  if (!merchant) {
    return res.status(503).json({ error: 'App not configured' });
  }

  // Return existing pending payment for the same orderId (idempotency)
  const existing = db
    .prepare("SELECT reconcile_code, amount, status, qr_code_image FROM payments WHERE merchant_id = ? AND order_id = ? AND status = 'pending'")
    .get(merchant.id, orderId) as PaymentRow | undefined;

  if (existing) {
    return res.json({
      reconcileCode: existing.reconcile_code,
      qrCodeImage: existing.qr_code_image,
      status: existing.status,
    });
  }

  const tingeeConfig = db
    .prepare('SELECT client_id_enc, secret_enc FROM tingee_configs WHERE merchant_id = ?')
    .get(merchant.id) as { client_id_enc: string; secret_enc: string } | undefined;
  if (!tingeeConfig) {
    return res.status(503).json({ error: 'Tingee not configured' });
  }

  const account = db
    .prepare('SELECT account_number, bank_bin FROM tingee_accounts WHERE merchant_id = ? AND is_default = 1')
    .get(merchant.id) as { account_number: string; bank_bin: string } | undefined;
  if (!account) {
    return res.status(503).json({ error: 'No default account selected' });
  }

  const key = process.env.ENCRYPTION_KEY!;
  const clientId = decrypt(tingeeConfig.client_id_enc, key);
  const secretToken = decrypt(tingeeConfig.secret_enc, key);
  const reconcileCode = generateReconcileCode();

  let qrCodeImage: string;
  try {
    const qr = await generateQR(clientId, secretToken, {
      bankBin: account.bank_bin,
      accountNumber: account.account_number,
      amount,
      content: reconcileCode,
    });
    qrCodeImage = qr.qrCodeImage;
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  }

  db.prepare(
    'INSERT INTO payments (merchant_id, order_id, reconcile_code, amount, qr_code_image) VALUES (?, ?, ?, ?, ?)'
  ).run(merchant.id, orderId, reconcileCode, amount, qrCodeImage);

  return res.json({ reconcileCode, qrCodeImage, status: 'pending' });
});

router.get('/:code/status', (req, res) => {
  const payment = db
    .prepare('SELECT status, amount, paid_at FROM payments WHERE reconcile_code = ?')
    .get(req.params.code) as { status: string; amount: number; paid_at: string | null } | undefined;

  if (!payment) {
    return res.status(404).json({ error: 'Payment not found' });
  }

  return res.json({ status: payment.status, amount: payment.amount, paid_at: payment.paid_at });
});

export default router;
