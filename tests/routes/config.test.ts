import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';

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
import configRouter from '../../src/routes/config';

const mockGetVaList = tingee.getVaList as jest.MockedFunction<typeof tingee.getVaList>;

const app = express();
app.use(express.json());
app.use('/api/config', configRouter);

const realDb = db as unknown as InstanceType<typeof Database>;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
});

afterEach(() => {
  realDb.exec(
    'DELETE FROM tingee_accounts; DELETE FROM tingee_configs; DELETE FROM payments; DELETE FROM webhook_events; DELETE FROM oauth_states; DELETE FROM merchants;'
  );
  jest.clearAllMocks();
});

const SHOP = 'shop.myharavan.com';
const SAMPLE_ACCOUNTS = [
  { accountNumber: '123456789', bankBin: '970422', bankName: 'MB' },
];

function seedMerchant(shopDomain = SHOP) {
  const { lastInsertRowid } = realDb
    .prepare("INSERT INTO merchants (shop_domain, access_token_enc) VALUES (?, 'enc')")
    .run(shopDomain);
  return lastInsertRowid as number;
}

describe('GET /api/config', () => {
  test('returns 400 when shop param is missing', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(400);
  });

  test('returns all false when merchant is not installed', async () => {
    const res = await request(app).get(`/api/config?shop=${SHOP}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tingeeConfigured: false, accountSelected: false });
  });

  test('returns tingeeConfigured=false when only merchant exists (no Tingee config)', async () => {
    seedMerchant();
    const res = await request(app).get(`/api/config?shop=${SHOP}`);
    expect(res.body).toMatchObject({ tingeeConfigured: false, accountSelected: false, shopDomain: SHOP });
  });

  test('returns all true after full Tingee setup', async () => {
    const merchantId = seedMerchant();
    realDb
      .prepare('INSERT INTO tingee_configs (merchant_id, client_id_enc, secret_enc) VALUES (?, ?, ?)')
      .run(merchantId, 'c_enc', 's_enc');
    realDb
      .prepare('INSERT INTO tingee_accounts (merchant_id, account_number, bank_bin, is_default) VALUES (?, ?, ?, 1)')
      .run(merchantId, '123456789', '970422');

    const res = await request(app).get(`/api/config?shop=${SHOP}`);
    expect(res.body).toMatchObject({ tingeeConfigured: true, accountSelected: true });
  });

  test('response never includes access_token_enc or secret_enc', async () => {
    seedMerchant();
    const res = await request(app).get(`/api/config?shop=${SHOP}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('access_token_enc');
    expect(body).not.toContain('secret_enc');
  });

  test('shopA config not visible via shopB shop param (isolation)', async () => {
    const idA = seedMerchant('shopaaa.myharavan.com');
    realDb
      .prepare('INSERT INTO tingee_configs (merchant_id, client_id_enc, secret_enc) VALUES (?, ?, ?)')
      .run(idA, 'c_enc', 's_enc');

    const res = await request(app).get('/api/config?shop=shopbbb.myharavan.com');
    expect(res.body.tingeeConfigured).toBe(false);
  });
});

describe('POST /api/config/tingee', () => {
  test('returns 400 when shop param is missing', async () => {
    const res = await request(app).post('/api/config/tingee').send({ clientId: 'x', secretToken: 'y' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when shop not installed', async () => {
    const res = await request(app)
      .post(`/api/config/tingee?shop=${SHOP}`)
      .send({ clientId: 'x', secretToken: 'y' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not installed/i);
  });

  test('returns 400 when clientId is missing', async () => {
    seedMerchant();
    const res = await request(app)
      .post(`/api/config/tingee?shop=${SHOP}`)
      .send({ secretToken: 'secret_abc' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when Tingee rejects credentials', async () => {
    seedMerchant();
    mockGetVaList.mockRejectedValueOnce(new Error('Tingee error: 97'));
    const res = await request(app)
      .post(`/api/config/tingee?shop=${SHOP}`)
      .send({ clientId: 'bad', secretToken: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch('97');
  });

  test('returns accounts list on success and saves encrypted credentials', async () => {
    const merchantId = seedMerchant();
    mockGetVaList.mockResolvedValueOnce(SAMPLE_ACCOUNTS as any);

    const res = await request(app)
      .post(`/api/config/tingee?shop=${SHOP}`)
      .send({ clientId: 'client_123', secretToken: 'secret_abc' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accounts: SAMPLE_ACCOUNTS });

    const config = realDb.prepare('SELECT id FROM tingee_configs WHERE merchant_id = ?').get(merchantId);
    expect(config).toBeTruthy();
  });

  test('updates existing config on second call (no duplicate)', async () => {
    const merchantId = seedMerchant();
    mockGetVaList.mockResolvedValue(SAMPLE_ACCOUNTS as any);

    await request(app).post(`/api/config/tingee?shop=${SHOP}`).send({ clientId: 'c1', secretToken: 's1' });
    await request(app).post(`/api/config/tingee?shop=${SHOP}`).send({ clientId: 'c2', secretToken: 's2' });

    const count = (
      realDb.prepare('SELECT COUNT(*) as n FROM tingee_configs WHERE merchant_id = ?').get(merchantId) as { n: number }
    ).n;
    expect(count).toBe(1);
  });
});

describe('POST /api/config/account', () => {
  test('returns 400 when shop param is missing', async () => {
    const res = await request(app).post('/api/config/account').send({ accountNumber: '123', bankBin: '970422' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when shop not installed', async () => {
    const res = await request(app)
      .post(`/api/config/account?shop=${SHOP}`)
      .send({ accountNumber: '123', bankBin: '970422' });
    expect(res.status).toBe(404);
  });

  test('inserts account and returns ok', async () => {
    const merchantId = seedMerchant();
    const res = await request(app)
      .post(`/api/config/account?shop=${SHOP}`)
      .send({ accountNumber: '123456789', bankBin: '970422', bankName: 'MB' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const account = realDb
      .prepare('SELECT * FROM tingee_accounts WHERE merchant_id = ? AND is_default = 1')
      .get(merchantId) as any;
    expect(account.account_number).toBe('123456789');
    expect(account.bank_bin).toBe('970422');
  });

  test('returns 400 when accountNumber is missing', async () => {
    seedMerchant();
    const res = await request(app)
      .post(`/api/config/account?shop=${SHOP}`)
      .send({ bankBin: '970422' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when bankBin is missing', async () => {
    seedMerchant();
    const res = await request(app)
      .post(`/api/config/account?shop=${SHOP}`)
      .send({ accountNumber: '123456789' });
    expect(res.status).toBe(400);
  });

  test('clears previous default before setting new one', async () => {
    const merchantId = seedMerchant();
    realDb
      .prepare('INSERT INTO tingee_accounts (merchant_id, account_number, bank_bin, is_default) VALUES (?, ?, ?, 1)')
      .run(merchantId, '111111111', '970422');

    await request(app)
      .post(`/api/config/account?shop=${SHOP}`)
      .send({ accountNumber: '999999999', bankBin: '970418', bankName: 'VCB' });

    const defaults = realDb
      .prepare('SELECT * FROM tingee_accounts WHERE merchant_id = ? AND is_default = 1')
      .all(merchantId) as any[];
    expect(defaults).toHaveLength(1);
    expect(defaults[0].account_number).toBe('999999999');
  });
});

describe('GET /api/config — full setup flow', () => {
  test('reflects state at each step of setup', async () => {
    seedMerchant();

    let res = await request(app).get(`/api/config?shop=${SHOP}`);
    expect(res.body).toMatchObject({ tingeeConfigured: false, accountSelected: false });

    mockGetVaList.mockResolvedValueOnce(SAMPLE_ACCOUNTS as any);
    await request(app)
      .post(`/api/config/tingee?shop=${SHOP}`)
      .send({ clientId: 'c', secretToken: 's' });

    res = await request(app).get(`/api/config?shop=${SHOP}`);
    expect(res.body).toMatchObject({ tingeeConfigured: true, accountSelected: false });

    await request(app)
      .post(`/api/config/account?shop=${SHOP}`)
      .send({ accountNumber: '123456789', bankBin: '970422', bankName: 'MB' });

    res = await request(app).get(`/api/config?shop=${SHOP}`);
    expect(res.body).toMatchObject({ tingeeConfigured: true, accountSelected: true });
  });
});
