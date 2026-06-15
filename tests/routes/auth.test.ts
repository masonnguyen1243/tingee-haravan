import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import { createHmac } from 'node:crypto';

jest.mock('../../src/db/index', () => {
  const Db = require('better-sqlite3');
  const { SQL_CREATE_TABLES } = require('../../src/db/schema');
  const db = new Db(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SQL_CREATE_TABLES);
  return { __esModule: true, default: db };
});

jest.mock('../../src/services/haravan', () => ({
  getShop: jest.fn(),
  getOrder: jest.fn(),
  markOrderPaid: jest.fn(),
  registerScriptTag: jest.fn(),
}));

import db from '../../src/db/index';
import * as haravan from '../../src/services/haravan';
import authRouter from '../../src/routes/auth';

const mockRegisterScriptTag = haravan.registerScriptTag as jest.MockedFunction<typeof haravan.registerScriptTag>;

const app = express();
app.use(express.json());
app.use('/auth', authRouter);

const realDb = db as unknown as InstanceType<typeof Database>;

const TEST_KEY = 'a'.repeat(64);
const TEST_API_KEY = 'test_client_id';
const TEST_API_SECRET = 'test_client_secret';
const TEST_APP_URL = 'https://test.ngrok.io';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY;
  process.env.HARAVAN_API_KEY = TEST_API_KEY;
  process.env.HARAVAN_API_SECRET = TEST_API_SECRET;
  process.env.APP_URL = TEST_APP_URL;
});

afterEach(() => {
  realDb.exec('DELETE FROM oauth_states; DELETE FROM tingee_accounts; DELETE FROM tingee_configs; DELETE FROM payments; DELETE FROM webhook_events; DELETE FROM merchants;');
  jest.clearAllMocks();
});

function buildValidHmac(params: Record<string, string>): string {
  const { hmac: _, ...rest } = params;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');
  return createHmac('sha256', TEST_API_SECRET).update(message).digest('hex');
}

describe('GET /auth/haravan', () => {
  test('returns 400 when shop param is missing', async () => {
    const res = await request(app).get('/auth/haravan');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/shop/i);
  });

  test('returns 400 for invalid shop domain format', async () => {
    const res = await request(app).get('/auth/haravan?shop=not-a-haravan-shop.com');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  test('redirects to Haravan OAuth URL for valid shop', async () => {
    const res = await request(app).get('/auth/haravan?shop=mystore.myharavan.com');
    expect(res.status).toBe(302);
    const location = res.headers['location'] as string;
    expect(location).toContain('mystore.myharavan.com/admin/oauth/authorize');
    expect(location).toContain(`client_id=${TEST_API_KEY}`);
    expect(location).toContain('scope=read_orders,write_orders');
    expect(location).toContain(encodeURIComponent(`${TEST_APP_URL}/auth/haravan/callback`));
  });

  test('saves state nonce in oauth_states table', async () => {
    await request(app).get('/auth/haravan?shop=mystore.myharavan.com');
    const row = realDb.prepare("SELECT * FROM oauth_states WHERE shop = 'mystore.myharavan.com'").get() as any;
    expect(row).toBeTruthy();
    expect(row.state).toBeTruthy();
    expect(row.shop).toBe('mystore.myharavan.com');
  });

  test('redirect URL contains the state nonce', async () => {
    const res = await request(app).get('/auth/haravan?shop=mystore.myharavan.com');
    const row = realDb.prepare("SELECT state FROM oauth_states WHERE shop = 'mystore.myharavan.com'").get() as { state: string };
    const location = res.headers['location'] as string;
    expect(location).toContain(`state=${row.state}`);
  });
});

describe('GET /auth/haravan/callback', () => {
  async function makeState(shop: string): Promise<string> {
    await request(app).get(`/auth/haravan?shop=${shop}`);
    const row = realDb.prepare(`SELECT state FROM oauth_states WHERE shop = ?`).get(shop) as { state: string };
    return row.state;
  }

  function mockTokenExchange(shop: string, accessToken: string, scope: string) {
    // Mock global fetch for token exchange
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: accessToken, scope }),
    } as any);
  }

  test('returns 400 when state is unknown', async () => {
    const query = { code: 'abc', shop: 'mystore.myharavan.com', state: 'unknown_state' };
    const hmac = buildValidHmac(query);
    const res = await request(app).get(
      `/auth/haravan/callback?code=${query.code}&shop=${query.shop}&state=${query.state}&hmac=${hmac}`
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid|expired/i);
  });

  test('returns 400 when HMAC is invalid', async () => {
    const shop = 'mystore.myharavan.com';
    const state = await makeState(shop);

    const res = await request(app).get(
      `/auth/haravan/callback?code=abc&shop=${shop}&state=${state}&hmac=bad_hmac`
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hmac/i);
  });

  test('valid callback upserts merchant and redirects to setup', async () => {
    const shop = 'mystore.myharavan.com';
    const state = await makeState(shop);

    const params: Record<string, string> = { code: 'auth_code_123', shop, state };
    const hmac = buildValidHmac(params);

    mockTokenExchange(shop, 'access_token_xyz', 'read_orders,write_orders');
    mockRegisterScriptTag.mockResolvedValueOnce(undefined);

    const res = await request(app).get(
      `/auth/haravan/callback?code=${params.code}&shop=${shop}&state=${state}&hmac=${hmac}`
    );

    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain(`/setup?shop=${shop}`);

    const merchant = realDb
      .prepare("SELECT shop_domain, scope FROM merchants WHERE shop_domain = ?")
      .get(shop) as { shop_domain: string; scope: string } | undefined;
    expect(merchant).toBeTruthy();
    expect(merchant!.scope).toBe('read_orders,write_orders');
  });

  test('calls registerScriptTag after token exchange', async () => {
    const shop = 'mystore.myharavan.com';
    const state = await makeState(shop);

    const params: Record<string, string> = { code: 'auth_code_123', shop, state };
    const hmac = buildValidHmac(params);

    mockTokenExchange(shop, 'access_token_xyz', 'read_orders,write_orders');
    mockRegisterScriptTag.mockResolvedValueOnce(undefined);

    await request(app).get(
      `/auth/haravan/callback?code=${params.code}&shop=${shop}&state=${state}&hmac=${hmac}`
    );

    expect(mockRegisterScriptTag).toHaveBeenCalledWith(
      'access_token_xyz',
      `${TEST_APP_URL}/payment-redirect.js`
    );
  });

  test('state nonce is deleted after successful callback (single-use)', async () => {
    const shop = 'mystore.myharavan.com';
    const state = await makeState(shop);

    const params: Record<string, string> = { code: 'auth_code_123', shop, state };
    const hmac = buildValidHmac(params);

    mockTokenExchange(shop, 'access_token_xyz', 'read_orders,write_orders');
    mockRegisterScriptTag.mockResolvedValue(undefined);

    await request(app).get(
      `/auth/haravan/callback?code=${params.code}&shop=${shop}&state=${state}&hmac=${hmac}`
    );

    const stateRow = realDb.prepare('SELECT id FROM oauth_states WHERE state = ?').get(state);
    expect(stateRow).toBeUndefined();
  });

  test('reinstalling same shop updates merchant (upsert, not duplicate)', async () => {
    const shop = 'mystore.myharavan.com';
    mockRegisterScriptTag.mockResolvedValue(undefined);

    // First install
    let state = await makeState(shop);
    let params: Record<string, string> = { code: 'code_1', shop, state };
    let hmac = buildValidHmac(params);
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token_1', scope: 'read_orders,write_orders' }) } as any);
    await request(app).get(`/auth/haravan/callback?code=${params.code}&shop=${shop}&state=${state}&hmac=${hmac}`);

    // Second install (re-install)
    state = await makeState(shop);
    params = { code: 'code_2', shop, state };
    hmac = buildValidHmac(params);
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token_2', scope: 'read_orders,write_orders' }) } as any);
    await request(app).get(`/auth/haravan/callback?code=${params.code}&shop=${shop}&state=${state}&hmac=${hmac}`);

    const count = (realDb.prepare('SELECT COUNT(*) as n FROM merchants').get() as { n: number }).n;
    expect(count).toBe(1);
  });

  test('returns 400 when state shop does not match callback shop', async () => {
    const shop = 'mystore.myharavan.com';
    const state = await makeState(shop);

    const wrongShop = 'otherstore.myharavan.com';
    const params: Record<string, string> = { code: 'abc', shop: wrongShop, state };
    const hmac = buildValidHmac(params);

    const res = await request(app).get(
      `/auth/haravan/callback?code=${params.code}&shop=${wrongShop}&state=${state}&hmac=${hmac}`
    );
    expect(res.status).toBe(400);
  });
});
