import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import { encrypt } from '../../src/utils/crypto';

jest.mock('../../src/db/index', () => {
  const Db = require('better-sqlite3');
  const { SQL_CREATE_TABLES } = require('../../src/db/schema');
  const db = new Db(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SQL_CREATE_TABLES);
  return { __esModule: true, default: db };
});

jest.mock('../../src/services/tingee', () => ({
  getVaList: jest.fn(),
  generateQR: jest.fn(),
}));

import db from '../../src/db/index';
import * as tingee from '../../src/services/tingee';
import paymentRouter from '../../src/routes/payment';

const mockGenerateQR = tingee.generateQR as jest.MockedFunction<typeof tingee.generateQR>;

const app = express();
app.use(express.json());
app.use('/api/payments', paymentRouter);

const realDb = db as unknown as InstanceType<typeof Database>;
const TEST_KEY = 'a'.repeat(64);

beforeAll(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY;
});

afterEach(() => {
  realDb.exec(
    'DELETE FROM tingee_accounts; DELETE FROM tingee_configs; DELETE FROM payments; DELETE FROM webhook_events; DELETE FROM merchants;'
  );
  jest.clearAllMocks();
});

function seedDb() {
  const { lastInsertRowid } = realDb
    .prepare("INSERT INTO merchants (shop_domain, access_token_enc) VALUES ('shop.myharavan.com', 'enc')")
    .run();
  const merchantId = lastInsertRowid as number;

  realDb
    .prepare('INSERT INTO tingee_configs (merchant_id, client_id_enc, secret_enc) VALUES (?, ?, ?)')
    .run(merchantId, encrypt('client_123', TEST_KEY), encrypt('secret_abc', TEST_KEY));

  realDb
    .prepare(
      'INSERT INTO tingee_accounts (merchant_id, account_number, bank_bin, is_default) VALUES (?, ?, ?, 1)'
    )
    .run(merchantId, '123456789', '970422');

  return merchantId;
}

describe('POST /api/payments', () => {
  test('creates a new payment and returns reconcileCode, qrCodeImage, status', async () => {
    seedDb();
    mockGenerateQR.mockResolvedValueOnce({ qrCode: 'qr_string', qrCodeImage: 'base64_img' });

    const res = await request(app)
      .post('/api/payments')
      .send({ orderId: 'order_123', amount: 500000, shop: 'shop.myharavan.com' });

    expect(res.status).toBe(200);
    expect(res.body.reconcileCode).toMatch(/^TG[A-Z0-9]{7}$/);
    expect(res.body.qrCodeImage).toBe('base64_img');
    expect(res.body.status).toBe('pending');
  });

  test('passes correct fields to generateQR including decrypted credentials', async () => {
    seedDb();
    mockGenerateQR.mockResolvedValueOnce({ qrCode: 'qr_string', qrCodeImage: 'base64_img' });

    const res = await request(app)
      .post('/api/payments')
      .send({ orderId: 'order_456', amount: 250000, shop: 'shop.myharavan.com' });

    expect(mockGenerateQR).toHaveBeenCalledWith(
      'client_123',
      'secret_abc',
      expect.objectContaining({
        bankBin: '970422',
        accountNumber: '123456789',
        amount: 250000,
        content: res.body.reconcileCode,
      })
    );
  });

  test('returns existing pending payment for same orderId without calling generateQR again', async () => {
    seedDb();
    mockGenerateQR.mockResolvedValueOnce({ qrCode: 'qr_string', qrCodeImage: 'base64_img' });

    const first = await request(app)
      .post('/api/payments')
      .send({ orderId: 'order_123', amount: 500000, shop: 'shop.myharavan.com' });

    const second = await request(app)
      .post('/api/payments')
      .send({ orderId: 'order_123', amount: 500000, shop: 'shop.myharavan.com' });

    expect(second.status).toBe(200);
    expect(second.body.reconcileCode).toBe(first.body.reconcileCode);
    expect(mockGenerateQR).toHaveBeenCalledTimes(1);
  });

  test('creates a new payment when previous orderId payment is not pending', async () => {
    const merchantId = seedDb();
    mockGenerateQR.mockResolvedValue({ qrCode: 'qr_string', qrCodeImage: 'base64_img' });

    // Insert a paid payment for the same orderId
    realDb
      .prepare(
        "INSERT INTO payments (merchant_id, order_id, reconcile_code, amount, status) VALUES (?, ?, ?, ?, 'paid')"
      )
      .run(merchantId, 'order_123', 'TGOLD0001', 500000);

    const res = await request(app)
      .post('/api/payments')
      .send({ orderId: 'order_123', amount: 500000, shop: 'shop.myharavan.com' });

    expect(res.status).toBe(200);
    expect(res.body.reconcileCode).not.toBe('TGOLD0001');
    expect(mockGenerateQR).toHaveBeenCalledTimes(1);
  });

  test('returns 404 when shop is not installed', async () => {
    const res = await request(app)
      .post('/api/payments')
      .send({ orderId: 'order_123', amount: 500000, shop: 'unknown.myharavan.com' });
    expect(res.status).toBe(404);
  });

  test('returns 400 when shop is missing', async () => {
    const res = await request(app).post('/api/payments').send({ orderId: 'order_123', amount: 500000 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when orderId is missing', async () => {
    const res = await request(app).post('/api/payments').send({ amount: 500000, shop: 'shop.myharavan.com' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when amount is missing', async () => {
    const res = await request(app).post('/api/payments').send({ orderId: 'order_123', shop: 'shop.myharavan.com' });
    expect(res.status).toBe(400);
  });

  test('returns 502 when generateQR fails', async () => {
    seedDb();
    mockGenerateQR.mockRejectedValueOnce(new Error('Tingee generateQR error: 97'));

    const res = await request(app)
      .post('/api/payments')
      .send({ orderId: 'order_123', amount: 500000, shop: 'shop.myharavan.com' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch('97');
  });
});

describe('GET /api/payments/:code/status', () => {
  test('returns status, amount, paid_at for a known reconcile code', async () => {
    const merchantId = seedDb();
    realDb
      .prepare(
        "INSERT INTO payments (merchant_id, order_id, reconcile_code, amount, status) VALUES (?, ?, ?, ?, 'pending')"
      )
      .run(merchantId, 'order_123', 'TGABC1234', 500000);

    const res = await request(app).get('/api/payments/TGABC1234/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'pending', amount: 500000, paid_at: null });
  });

  test('returns 404 for unknown reconcile code', async () => {
    const res = await request(app).get('/api/payments/TGUNKNOWN/status');
    expect(res.status).toBe(404);
  });

  test('reflects paid status with paid_at timestamp', async () => {
    const merchantId = seedDb();
    realDb
      .prepare(
        "INSERT INTO payments (merchant_id, order_id, reconcile_code, amount, status, paid_at) VALUES (?, ?, ?, ?, 'paid', datetime('now'))"
      )
      .run(merchantId, 'order_123', 'TGPAID001', 500000);

    const res = await request(app).get('/api/payments/TGPAID001/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
    expect(res.body.paid_at).toBeTruthy();
  });

  test('reflects mismatch status', async () => {
    const merchantId = seedDb();
    realDb
      .prepare(
        "INSERT INTO payments (merchant_id, order_id, reconcile_code, amount, status) VALUES (?, ?, ?, ?, 'mismatch')"
      )
      .run(merchantId, 'order_123', 'TGMIS0001', 500000);

    const res = await request(app).get('/api/payments/TGMIS0001/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('mismatch');
  });
});
