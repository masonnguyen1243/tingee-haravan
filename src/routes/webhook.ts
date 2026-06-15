import { Router } from 'express';
import { createHmac } from 'node:crypto';
import db from '../db';
import { decrypt } from '../utils/crypto';
import { markOrderPaid } from '../services/haravan';

const router = Router();

function computeSignature(timestamp: string, body: unknown, secretToken: string): string {
  return createHmac('sha512', secretToken)
    .update(`${timestamp}:${JSON.stringify(body)}`)
    .digest('hex');
}

router.post('/', async (req, res) => {
  const timestamp = req.headers['x-request-timestamp'] as string | undefined;
  const signature = req.headers['x-signature'] as string | undefined;
  const body = req.body as Record<string, unknown>;
  const rawPayload = JSON.stringify(body);
  const transactionCode = (body.transactionCode as string | undefined) ?? null;

  const key = process.env.ENCRYPTION_KEY!;

  // Load merchant + Tingee secret for signature verification
  const merchant = db
    .prepare('SELECT id, api_token_enc FROM merchants LIMIT 1')
    .get() as { id: number; api_token_enc: string } | undefined;

  const tingeeConfig = merchant
    ? (db
        .prepare('SELECT secret_enc FROM tingee_configs WHERE merchant_id = ?')
        .get(merchant.id) as { secret_enc: string } | undefined)
    : undefined;

  let secretToken: string | undefined;
  if (tingeeConfig) {
    try {
      secretToken = decrypt(tingeeConfig.secret_enc, key);
    } catch {
      // Treat decryption failure as missing config
    }
  }

  const signatureValid =
    !!(timestamp && signature && secretToken &&
      computeSignature(timestamp, body, secretToken) === signature);

  if (!signatureValid) {
    db.prepare(
      'INSERT INTO webhook_events (tingee_transaction_code, raw_payload, signature_valid) VALUES (?, ?, 0)'
    ).run(transactionCode, rawPayload);
    return res.json({ code: '00' });
  }

  // Idempotency: reject duplicate transactionCode from valid events
  if (transactionCode) {
    const duplicate = db
      .prepare(
        'SELECT id FROM webhook_events WHERE tingee_transaction_code = ? AND signature_valid = 1'
      )
      .get(transactionCode);
    if (duplicate) {
      return res.json({ code: '00' });
    }
  }

  // Extract reconcile code from content
  const content = body.content as string | undefined;
  const codeMatch = content?.match(/TG[A-Z0-9]+/);
  const reconcileCode = codeMatch?.[0];

  if (!reconcileCode) {
    db.prepare(
      'INSERT INTO webhook_events (tingee_transaction_code, raw_payload, signature_valid) VALUES (?, ?, 1)'
    ).run(transactionCode, rawPayload);
    return res.json({ code: '00' });
  }

  // Look up payment
  const payment = db
    .prepare('SELECT id, order_id, amount FROM payments WHERE reconcile_code = ?')
    .get(reconcileCode) as { id: number; order_id: string; amount: number } | undefined;

  if (!payment) {
    db.prepare(
      'INSERT INTO webhook_events (tingee_transaction_code, raw_payload, signature_valid) VALUES (?, ?, 1)'
    ).run(transactionCode, rawPayload);
    return res.json({ code: '00' });
  }

  const webhookAmount = body.amount as number | undefined;

  if (webhookAmount !== payment.amount) {
    db.prepare(
      'INSERT INTO webhook_events (tingee_transaction_code, raw_payload, signature_valid) VALUES (?, ?, 1)'
    ).run(transactionCode, rawPayload);
    db.prepare("UPDATE payments SET status = 'mismatch' WHERE id = ?").run(payment.id);
    return res.json({ code: '00' });
  }

  // Amounts match — mark order paid on Haravan
  try {
    const haravanToken = decrypt(merchant!.api_token_enc, key);
    await markOrderPaid(haravanToken, payment.order_id, payment.amount);
  } catch {
    db.prepare(
      'INSERT INTO webhook_events (tingee_transaction_code, raw_payload, signature_valid) VALUES (?, ?, 1)'
    ).run(transactionCode, rawPayload);
    return res.json({ code: '00' });
  }

  db.transaction(() => {
    db.prepare("UPDATE payments SET status = 'paid', paid_at = datetime('now') WHERE id = ?").run(
      payment.id
    );
    db.prepare(
      'INSERT INTO webhook_events (tingee_transaction_code, raw_payload, matched_payment_id, signature_valid) VALUES (?, ?, ?, 1)'
    ).run(transactionCode, rawPayload, payment.id);
  })();

  return res.json({ code: '00', message: 'Success' });
});

export default router;
