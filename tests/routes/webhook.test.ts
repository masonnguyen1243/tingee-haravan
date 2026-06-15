import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import { createHmac } from 'node:crypto';
import { encrypt } from '../../src/utils/crypto';

jest.mock('../../src/db/index', () => {
  const Db = require('better-sqlite3');
  const { SQL_CREATE_TABLES } = require('../../src/db/schema');
  const db = new Db(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SQL_CREATE_TABLES);
  return { __esModule: true, default: db };
});

jest.mock('../../src/services/haravan', () => ({
  validateToken: jest.fn(),
  getOrder: jest.fn(),
  markOrderPaid: jest.fn(),
}));

import db from '../../src/db/index';
import * as haravan from '../../src/services/haravan';
import webhookRouter from '../../src/routes/webhook';

const mockMarkOrderPaid = haravan.markOrderPaid as jest.MockedFunction<typeof haravan.markOrderPaid>;

const app = express();
app.use(express.json());
app.use('/webhook/tingee', webhookRouter);

const realDb = db as unknown as InstanceType<typeof Database>;
const TEST_KEY = 'a'.repeat(64);
const SECRET_TOKEN = 'secret_abc_123';
const HARAVAN_TOKEN = 'haravan_tok_xyz';
const RECONCILE_CODE = 'TGABC1234';
const ORDER_ID = 'order_999';
const AMOUNT = 500000;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY;
});

afterEach(() => {
  // webhook_events references payments, so delete it first
  realDb.exec(
    'DELETE FROM webhook_events; DELETE FROM tingee_accounts; DELETE FROM tingee_configs; DELETE FROM payments; DELETE FROM merchants;'
  );
  jest.clearAllMocks();
});

function makeSignature(timestamp: string, body: object): string {
  return createHmac('sha512', SECRET_TOKEN)
    .update(`${timestamp}:${JSON.stringify(body)}`)
    .digest('hex');
}

function seedDb() {
  const { lastInsertRowid } = realDb
    .prepare("INSERT INTO merchants (shop_domain, api_token_enc) VALUES ('shop.myharavan.com', ?)")
    .run(encrypt(HARAVAN_TOKEN, TEST_KEY));
  const merchantId = lastInsertRowid as number;

  realDb
    .prepare('INSERT INTO tingee_configs (merchant_id, client_id_enc, secret_enc) VALUES (?, ?, ?)')
    .run(merchantId, encrypt('client_123', TEST_KEY), encrypt(SECRET_TOKEN, TEST_KEY));

  const { lastInsertRowid: paymentId } = realDb
    .prepare(
      "INSERT INTO payments (merchant_id, order_id, reconcile_code, amount, status) VALUES (?, ?, ?, ?, 'pending')"
    )
    .run(merchantId, ORDER_ID, RECONCILE_CODE, AMOUNT);

  return { merchantId, paymentId: paymentId as number };
}

function makeBody(overrides?: Partial<Record<string, unknown>>) {
  return {
    transactionCode: 'TXN001',
    content: `Payment for ${RECONCILE_CODE} thank you`,
    amount: AMOUNT,
    ...overrides,
  };
}

describe('POST /webhook/tingee — valid signature + amount match', () => {
  test('marks order paid and returns success', async () => {
    seedDb();
    mockMarkOrderPaid.mockResolvedValueOnce(undefined);
    const body = makeBody();
    const timestamp = '20240115103000000';

    const res = await request(app)
      .post('/webhook/tingee')
      .set('x-request-timestamp', timestamp)
      .set('x-signature', makeSignature(timestamp, body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: '00', message: 'Success' });
    expect(mockMarkOrderPaid).toHaveBeenCalledWith(HARAVAN_TOKEN, ORDER_ID, AMOUNT);
  });

  test('updates payment status to paid with paid_at', async () => {
    seedDb();
    mockMarkOrderPaid.mockResolvedValueOnce(undefined);
    const body = makeBody();
    const timestamp = '20240115103000000';

    await request(app)
      .post('/webhook/tingee')
      .set('x-request-timestamp', timestamp)
      .set('x-signature', makeSignature(timestamp, body))
      .send(body);

    const payment = realDb
      .prepare('SELECT status, paid_at FROM payments WHERE reconcile_code = ?')
      .get(RECONCILE_CODE) as { status: string; paid_at: string | null };
    expect(payment.status).toBe('paid');
    expect(payment.paid_at).toBeTruthy();
  });

  test('logs event to webhook_events with matched_payment_id and signature_valid=1', async () => {
    const { paymentId } = seedDb();
    mockMarkOrderPaid.mockResolvedValueOnce(undefined);
    const body = makeBody();
    const timestamp = '20240115103000000';

    await request(app)
      .post('/webhook/tingee')
      .set('x-request-timestamp', timestamp)
      .set('x-signature', makeSignature(timestamp, body))
      .send(body);

    const event = realDb
      .prepare('SELECT * FROM webhook_events WHERE tingee_transaction_code = ?')
      .get('TXN001') as any;
    expect(event).toBeTruthy();
    expect(event.signature_valid).toBe(1);
    expect(event.matched_payment_id).toBe(paymentId);
  });
});

describe('POST /webhook/tingee — invalid signature', () => {
  test('returns 200 {code: "00"} without processing', async () => {
    seedDb();
    const body = makeBody();

    const res = await request(app)
      .post('/webhook/tingee')
      .set('x-request-timestamp', '20240115103000000')
      .set('x-signature', 'deadbeefdeadbeef')
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: '00' });
    expect(mockMarkOrderPaid).not.toHaveBeenCalled();
  });

  test('logs event with signature_valid=0', async () => {
    seedDb();
    const body = makeBody();

    await request(app)
      .post('/webhook/tingee')
      .set('x-request-timestamp', '20240115103000000')
      .set('x-signature', 'badsignature')
      .send(body);

    const event = realDb
      .prepare('SELECT signature_valid FROM webhook_events WHERE tingee_transaction_code = ?')
      .get('TXN001') as any;
    expect(event).toBeTruthy();
    expect(event.signature_valid).toBe(0);
  });

  test('does not update payment status', async () => {
    seedDb();
    const body = makeBody();

    await request(app)
      .post('/webhook/tingee')
      .set('x-request-timestamp', '20240115103000000')
      .set('x-signature', 'badsignature')
      .send(body);

    const payment = realDb
      .prepare('SELECT status FROM payments WHERE reconcile_code = ?')
      .get(RECONCILE_CODE) as { status: string };
    expect(payment.status).toBe('pending');
  });

  test('missing signature header is treated as invalid', async () => {
    seedDb();
    const res = await request(app)
      .post('/webhook/tingee')
      .set('x-request-timestamp', '20240115103000000')
      .send(makeBody());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: '00' });
    expect(mockMarkOrderPaid).not.toHaveBeenCalled();
  });
});

describe('POST /webhook/tingee — duplicate transactionCode', () => {
  test('does not call markOrderPaid a second time', async () => {
    seedDb();
    mockMarkOrderPaid.mockResolvedValue(undefined);
    const body = makeBody();
    const timestamp = '20240115103000000';
    const sig = makeSignature(timestamp, body);

    // First request — should succeed
    await request(app)
      .post('/webhook/tingee')
      .set('x-request-timestamp', timestamp)
      .set('x-signature', sig)
      .send(body);

    expect(mockMarkOrderPaid).toHaveBeenCalledTimes(1);

    // Second request with same transactionCode — should be ignored
    const res = await request(app)
      .post('/webhook/tingee')
      .set('x-request-timestamp', timestamp)
      .set('x-signature', sig)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: '00' });
    expect(mockMarkOrderPaid).toHaveBeenCalledTimes(1);
  });

  test('does not create a second webhook_events log entry for the duplicate', async () => {
    seedDb();
    mockMarkOrderPaid.mockResolvedValue(undefined);
    const body = makeBody();
    const timestamp = '20240115103000000';
    const sig = makeSignature(timestamp, body);

    await request(app)
      .post('/webhook/tingee')
      .set('x-request-timestamp', timestamp)
      .set('x-signature', sig)
      .send(body);

    await request(app)
      .post('/webhook/tingee')
      .set('x-request-timestamp', timestamp)
      .set('x-signature', sig)
      .send(body);

    const count = (
      realDb
        .prepare('SELECT COUNT(*) as n FROM webhook_events WHERE tingee_transaction_code = ?')
        .get('TXN001') as { n: number }
    ).n;
    expect(count).toBe(1);
  });
});

describe('POST /webhook/tingee — amount mismatch', () => {
  test('sets payment status to mismatch and does not mark order paid', async () => {
    seedDb();
    const body = makeBody({ amount: AMOUNT + 1000 });
    const timestamp = '20240115103000000';

    const res = await request(app)
      .post('/webhook/tingee')
      .set('x-request-timestamp', timestamp)
      .set('x-signature', makeSignature(timestamp, body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: '00' });
    expect(mockMarkOrderPaid).not.toHaveBeenCalled();

    const payment = realDb
      .prepare('SELECT status FROM payments WHERE reconcile_code = ?')
      .get(RECONCILE_CODE) as { status: string };
    expect(payment.status).toBe('mismatch');
  });

  test('logs the mismatch event', async () => {
    seedDb();
    const body = makeBody({ amount: 1 });
    const timestamp = '20240115103000000';

    await request(app)
      .post('/webhook/tingee')
      .set('x-request-timestamp', timestamp)
      .set('x-signature', makeSignature(timestamp, body))
      .send(body);

    const event = realDb
      .prepare('SELECT signature_valid, matched_payment_id FROM webhook_events WHERE tingee_transaction_code = ?')
      .get('TXN001') as any;
    expect(event).toBeTruthy();
    expect(event.signature_valid).toBe(1);
    expect(event.matched_payment_id).toBeNull();
  });
});

describe('POST /webhook/tingee — reconcile code not found', () => {
  test('returns 200 without calling markOrderPaid when content has no reconcile code', async () => {
    seedDb();
    const body = makeBody({ content: 'No code here' });
    const timestamp = '20240115103000000';

    const res = await request(app)
      .post('/webhook/tingee')
      .set('x-request-timestamp', timestamp)
      .set('x-signature', makeSignature(timestamp, body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: '00' });
    expect(mockMarkOrderPaid).not.toHaveBeenCalled();
  });

  test('returns 200 when reconcile code not in payments table', async () => {
    seedDb();
    const body = makeBody({ content: 'Payment for TGUNKNOWN1' });
    const timestamp = '20240115103000000';

    const res = await request(app)
      .post('/webhook/tingee')
      .set('x-request-timestamp', timestamp)
      .set('x-signature', makeSignature(timestamp, body))
      .send(body);

    expect(res.status).toBe(200);
    expect(mockMarkOrderPaid).not.toHaveBeenCalled();
  });
});
