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

jest.mock('../../src/services/haravan', () => ({
  validateToken: jest.fn(),
  getOrder: jest.fn(),
  markOrderPaid: jest.fn(),
}));

jest.mock('../../src/services/tingee', () => ({
  getVaList: jest.fn(),
  generateQR: jest.fn(),
}));

import db from '../../src/db/index';
import * as haravan from '../../src/services/haravan';
import * as tingee from '../../src/services/tingee';
import configRouter from '../../src/routes/config';

const mockValidateToken = haravan.validateToken as jest.MockedFunction<typeof haravan.validateToken>;
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
    'DELETE FROM tingee_accounts; DELETE FROM tingee_configs; DELETE FROM payments; DELETE FROM webhook_events; DELETE FROM merchants;'
  );
  jest.clearAllMocks();
});

const SAMPLE_ACCOUNTS = [
  { accountNumber: '123456789', bankBin: '970422', bankName: 'MB' },
];

describe('GET /api/config', () => {
  test('returns all false when nothing is configured', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ haravanConfigured: false, tingeeConfigured: false, accountSelected: false });
  });

  test('returns haravanConfigured=true after merchant is inserted', async () => {
    realDb
      .prepare("INSERT INTO merchants (shop_domain, api_token_enc) VALUES ('shop.myharavan.com', 'enc')")
      .run();
    const res = await request(app).get('/api/config');
    expect(res.body).toEqual({ haravanConfigured: true, tingeeConfigured: false, accountSelected: false });
  });

  test('returns all true after full setup', async () => {
    realDb
      .prepare("INSERT INTO merchants (shop_domain, api_token_enc) VALUES ('shop.myharavan.com', 'enc')")
      .run();
    const merchant = realDb.prepare('SELECT id FROM merchants LIMIT 1').get() as { id: number };
    realDb
      .prepare('INSERT INTO tingee_configs (merchant_id, client_id_enc, secret_enc) VALUES (?, ?, ?)')
      .run(merchant.id, 'c_enc', 's_enc');
    realDb
      .prepare(
        'INSERT INTO tingee_accounts (merchant_id, account_number, bank_bin, is_default) VALUES (?, ?, ?, 1)'
      )
      .run(merchant.id, '123456789', '970422');

    const res = await request(app).get('/api/config');
    expect(res.body).toEqual({ haravanConfigured: true, tingeeConfigured: true, accountSelected: true });
  });

  test('response body does not contain raw tokens', async () => {
    realDb
      .prepare("INSERT INTO merchants (shop_domain, api_token_enc) VALUES ('shop.myharavan.com', 'enc')")
      .run();
    const res = await request(app).get('/api/config');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('api_token_enc');
    expect(body).not.toContain('secret_enc');
  });
});

describe('POST /api/config/haravan', () => {
  test('validates token and saves merchant', async () => {
    mockValidateToken.mockResolvedValueOnce(undefined);
    const res = await request(app)
      .post('/api/config/haravan')
      .send({ shopDomain: 'shop.myharavan.com', apiToken: 'tok_abc' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockValidateToken).toHaveBeenCalledWith('tok_abc');

    const merchant = realDb
      .prepare("SELECT shop_domain FROM merchants WHERE shop_domain = 'shop.myharavan.com'")
      .get();
    expect(merchant).toBeTruthy();
  });

  test('upserts merchant when same shopDomain is posted again', async () => {
    mockValidateToken.mockResolvedValue(undefined);
    await request(app)
      .post('/api/config/haravan')
      .send({ shopDomain: 'shop.myharavan.com', apiToken: 'tok_1' });
    await request(app)
      .post('/api/config/haravan')
      .send({ shopDomain: 'shop.myharavan.com', apiToken: 'tok_2' });

    const count = (
      realDb.prepare('SELECT COUNT(*) as n FROM merchants').get() as { n: number }
    ).n;
    expect(count).toBe(1);
  });

  test('returns 400 when apiToken is rejected by Haravan', async () => {
    mockValidateToken.mockRejectedValueOnce(new Error('Haravan token invalid: 401'));
    const res = await request(app)
      .post('/api/config/haravan')
      .send({ shopDomain: 'shop.myharavan.com', apiToken: 'bad_token' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch('401');
  });

  test('returns 400 when shopDomain is missing', async () => {
    const res = await request(app)
      .post('/api/config/haravan')
      .send({ apiToken: 'tok_abc' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when apiToken is missing', async () => {
    const res = await request(app)
      .post('/api/config/haravan')
      .send({ shopDomain: 'shop.myharavan.com' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/config/tingee', () => {
  beforeEach(() => {
    realDb
      .prepare("INSERT INTO merchants (shop_domain, api_token_enc) VALUES ('shop.myharavan.com', 'enc')")
      .run();
  });

  test('returns accounts list on success', async () => {
    mockGetVaList.mockResolvedValueOnce(SAMPLE_ACCOUNTS as any);
    const res = await request(app)
      .post('/api/config/tingee')
      .send({ clientId: 'client_123', secretToken: 'secret_abc' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accounts: SAMPLE_ACCOUNTS });
    expect(mockGetVaList).toHaveBeenCalledWith('client_123', 'secret_abc');
  });

  test('saves encrypted credentials in DB', async () => {
    mockGetVaList.mockResolvedValueOnce(SAMPLE_ACCOUNTS as any);
    await request(app)
      .post('/api/config/tingee')
      .send({ clientId: 'client_123', secretToken: 'secret_abc' });

    const merchant = realDb.prepare('SELECT id FROM merchants LIMIT 1').get() as { id: number };
    const config = realDb
      .prepare('SELECT id FROM tingee_configs WHERE merchant_id = ?')
      .get(merchant.id);
    expect(config).toBeTruthy();
  });

  test('updates existing config on second call', async () => {
    mockGetVaList.mockResolvedValue(SAMPLE_ACCOUNTS as any);
    await request(app)
      .post('/api/config/tingee')
      .send({ clientId: 'client_1', secretToken: 'secret_1' });
    await request(app)
      .post('/api/config/tingee')
      .send({ clientId: 'client_2', secretToken: 'secret_2' });

    const merchant = realDb.prepare('SELECT id FROM merchants LIMIT 1').get() as { id: number };
    const count = (
      realDb
        .prepare('SELECT COUNT(*) as n FROM tingee_configs WHERE merchant_id = ?')
        .get(merchant.id) as { n: number }
    ).n;
    expect(count).toBe(1);
  });

  test('returns 400 when Tingee rejects credentials', async () => {
    mockGetVaList.mockRejectedValueOnce(new Error('Tingee getVaList error: 97'));
    const res = await request(app)
      .post('/api/config/tingee')
      .send({ clientId: 'bad_client', secretToken: 'bad_secret' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch('97');
  });

  test('returns 400 when clientId is missing', async () => {
    const res = await request(app)
      .post('/api/config/tingee')
      .send({ secretToken: 'secret_abc' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/config/account', () => {
  beforeEach(() => {
    realDb
      .prepare("INSERT INTO merchants (shop_domain, api_token_enc) VALUES ('shop.myharavan.com', 'enc')")
      .run();
  });

  test('inserts account and returns ok', async () => {
    const res = await request(app)
      .post('/api/config/account')
      .send({ accountNumber: '123456789', bankBin: '970422', bankName: 'MB' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const merchant = realDb.prepare('SELECT id FROM merchants LIMIT 1').get() as { id: number };
    const account = realDb
      .prepare('SELECT * FROM tingee_accounts WHERE merchant_id = ? AND is_default = 1')
      .get(merchant.id) as any;
    expect(account).toBeTruthy();
    expect(account.account_number).toBe('123456789');
    expect(account.bank_bin).toBe('970422');
  });

  test('clears previous default before setting new one', async () => {
    const merchant = realDb.prepare('SELECT id FROM merchants LIMIT 1').get() as { id: number };
    realDb
      .prepare(
        'INSERT INTO tingee_accounts (merchant_id, account_number, bank_bin, is_default) VALUES (?, ?, ?, 1)'
      )
      .run(merchant.id, '111111111', '970422');

    await request(app)
      .post('/api/config/account')
      .send({ accountNumber: '999999999', bankBin: '970418', bankName: 'VCB' });

    const defaults = realDb
      .prepare('SELECT * FROM tingee_accounts WHERE merchant_id = ? AND is_default = 1')
      .all(merchant.id) as any[];
    expect(defaults).toHaveLength(1);
    expect(defaults[0].account_number).toBe('999999999');
  });

  test('returns 400 when accountNumber is missing', async () => {
    const res = await request(app)
      .post('/api/config/account')
      .send({ bankBin: '970422' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when bankBin is missing', async () => {
    const res = await request(app)
      .post('/api/config/account')
      .send({ accountNumber: '123456789' });
    expect(res.status).toBe(400);
  });
});

describe('Full setup flow', () => {
  test('GET /api/config reflects state at each step', async () => {
    // Initially all false
    let res = await request(app).get('/api/config');
    expect(res.body).toEqual({ haravanConfigured: false, tingeeConfigured: false, accountSelected: false });

    // Step 1: configure Haravan
    mockValidateToken.mockResolvedValueOnce(undefined);
    await request(app)
      .post('/api/config/haravan')
      .send({ shopDomain: 'shop.myharavan.com', apiToken: 'tok_abc' });

    res = await request(app).get('/api/config');
    expect(res.body).toEqual({ haravanConfigured: true, tingeeConfigured: false, accountSelected: false });

    // Step 2: configure Tingee
    mockGetVaList.mockResolvedValueOnce(SAMPLE_ACCOUNTS as any);
    await request(app)
      .post('/api/config/tingee')
      .send({ clientId: 'client_123', secretToken: 'secret_abc' });

    res = await request(app).get('/api/config');
    expect(res.body).toEqual({ haravanConfigured: true, tingeeConfigured: true, accountSelected: false });

    // Step 3: select account
    await request(app)
      .post('/api/config/account')
      .send({ accountNumber: '123456789', bankBin: '970422', bankName: 'MB' });

    res = await request(app).get('/api/config');
    expect(res.body).toEqual({ haravanConfigured: true, tingeeConfigured: true, accountSelected: true });
  });
});
