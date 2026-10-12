import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './files.js';
const scrypt = promisify(scryptCallback);
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function passwordHash(password) { const salt = randomBytes(16).toString('hex'); return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`; }
export async function passwordMatches(password, hash) { const [salt, hex] = hash.split(':'); const actual = await scrypt(password, salt, 64); return timingSafeEqual(actual, Buffer.from(hex, 'hex')); }
export function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, 'app.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', settings TEXT NOT NULL DEFAULT '{}', created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, created INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id), thread_id TEXT, payload TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS events_user ON events(user_id,seq);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, action TEXT, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created INTEGER NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, used_by TEXT REFERENCES users(id), used_at INTEGER);
    CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), thread_id TEXT NOT NULL REFERENCES threads(id), turn_id TEXT, name TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL, created INTEGER NOT NULL);`);
  const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(x => x.name));
  if (!columns.has('title_state')) db.exec("ALTER TABLE threads ADD COLUMN title_state TEXT NOT NULL DEFAULT 'manual'");
  if (!columns.has('token_usage')) db.exec('ALTER TABLE threads ADD COLUMN token_usage TEXT');
  // Upgrade the original installation owner once; never upgrade invited admins.
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare("SELECT name FROM migrations WHERE name='superadmin-v1'").get()) {
      if (!db.prepare("SELECT id FROM users WHERE role='superadmin'").get()) {
        const owner = db.prepare('SELECT id,role FROM users ORDER BY created,rowid LIMIT 1').get();
        if (owner?.role === 'admin') db.prepare("UPDATE users SET role='superadmin' WHERE id=?").run(owner.id);
      }
      db.prepare('INSERT INTO migrations(name,created) VALUES(?,?)').run('superadmin-v1', Date.now());
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const user = id => get('SELECT * FROM users WHERE id=?', id);
  const auth = req => {
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('sv_session='))?.slice(11);
    if (!cookie || cookie.length !== 64) return null;
    return get('SELECT u.*,s.csrf,s.hash AS session_hash,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>?', digest(cookie), Date.now());
  };
  const project = (u, id) => { const p = get('SELECT * FROM projects WHERE id=? AND user_id=?', id, u.id); if (!p) fail(404, '项目不存在'); return p; };
  const thread = (u, id) => { const t = get('SELECT * FROM threads WHERE id=? AND user_id=?', id, u.id); if (!t) fail(404, '对话不存在'); return t; };
  const audit = (uid, action) => run('INSERT INTO audit(user_id,action,created) VALUES(?,?,?)', uid, action, Date.now());
  const prune = () => { run('DELETE FROM sessions WHERE expires<?', Date.now()); run('DELETE FROM events WHERE created<?', Date.now() - 7 * 86400000); run('DELETE FROM audit WHERE created<?', Date.now() - 90 * 86400000); };
  prune();
  return { db, get, all, run, user, auth, project, thread, audit, prune };
}
