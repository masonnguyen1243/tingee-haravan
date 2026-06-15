import Database from 'better-sqlite3';
import { SQL_CREATE_TABLES } from '../../src/db/schema';

let db: InstanceType<typeof Database>;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SQL_CREATE_TABLES);
});

afterEach(() => {
  db.close();
});

function getTables(database: InstanceType<typeof Database>): string[] {
  return (database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
    (r) => r.name
  );
}

describe('schema', () => {
  test('all 6 tables exist after init', () => {
    const tables = getTables(db);
    expect(tables).toContain('merchants');
    expect(tables).toContain('oauth_states');
    expect(tables).toContain('tingee_configs');
    expect(tables).toContain('tingee_accounts');
    expect(tables).toContain('payments');
    expect(tables).toContain('webhook_events');
  });

  test('payments.reconcile_code has UNIQUE constraint', () => {
    db.exec(`
      INSERT INTO merchants (shop_domain, access_token_enc) VALUES ('test.myharavan.com', 'enc1');
    `);
    db.exec(`
      INSERT INTO payments (merchant_id, order_id, reconcile_code, amount)
      VALUES (1, 'order_1', 'TGAAAAAAA', 100000);
    `);

    expect(() => {
      db.exec(`
        INSERT INTO payments (merchant_id, order_id, reconcile_code, amount)
        VALUES (1, 'order_2', 'TGAAAAAAA', 200000);
      `);
    }).toThrow();
  });

  test('running schema twice is idempotent (CREATE TABLE IF NOT EXISTS)', () => {
    expect(() => db.exec(SQL_CREATE_TABLES)).not.toThrow();
  });

  test('foreign keys are enforced on tingee_configs', () => {
    expect(() => {
      db.exec(`
        INSERT INTO tingee_configs (merchant_id, client_id_enc, secret_enc)
        VALUES (999, 'enc_client', 'enc_secret');
      `);
    }).toThrow();
  });
});
