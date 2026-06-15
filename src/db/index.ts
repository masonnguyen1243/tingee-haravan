import Database from 'better-sqlite3';
import path from 'path';
import { SQL_CREATE_TABLES } from './schema';

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(process.cwd(), 'data', 'tingee.db');

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(SQL_CREATE_TABLES);

export default db;
