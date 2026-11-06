// SPDX-License-Identifier: MIT
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, readdirSync, statfsSync, openSync, closeSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export class LeaseError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
export function fail(code, message, details) { throw new LeaseError(code, message, details); }
export function text(value, name, max = 2048) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
    fail('USAGE', `${name} must be a nonempty string of at most ${max} characters without control characters.`);
  }
  return value;
}
export function integer(value, name, min, max) {
  if (!(typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))) fail('USAGE', `${name} must be a decimal integer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) fail('USAGE', `${name} must be an integer from ${min} to ${max}.`);
  return number;
}
const digest = token => createHash('sha256').update(token).digest('hex');
// Best effort: these common network/VM mounts cannot safely coordinate SQLite writers.
const unsafeFs = new Set([0x6969, 0x517b, 0xff534d42, 0xfe534d42, 0x01021997, 0x65735546, 0x6a656a63, 0x786f4256, 0x7c7c6673, 0xbacbacbc]);
export function inspectRoot(root) {
  if (!isAbsolute(root)) fail('USAGE', 'The state root must be an absolute path.');
  if (process.platform === 'win32' && /^(?:\\\\|\/\/)/.test(root)) fail('UNSAFE_FILESYSTEM', 'UNC state directories are unsupported. Use local storage.');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('UNSAFE_ROOT', 'The state root must be a real directory, not a symlink.');
  if (process.platform !== 'win32' && ((info.mode & 0o077) || info.uid !== process.getuid())) {
    fail('UNSAFE_ROOT', 'The state root must belong to this OS user and have mode 0700. Use one service account for shared hosts.');
  }
  const filesystemType = Number(statfsSync(root).type) >>> 0;
  if (process.platform === 'linux' && unsafeFs.has(filesystemType)) fail('UNSAFE_FILESYSTEM', 'Network and shared VM filesystems are unsupported. Run the CLI on the device host with local storage.');
  const legacyLocks = readdirSync(root).filter(name => name.endsWith('.lock'));
  return { filesystemType, legacyLocks };
}
const publicLease = row => row && ({
  device: row.device, owner: row.owner, purpose: row.purpose, message: row.message,
  acquiredAt: row.acquired_at, lastActivityAt: row.last_activity_at,
  expiresAt: row.expires_at, ttlMs: row.ttl_ms,
});

export class LeaseStore {
  constructor({ root, idleTimeoutMinutes = 15, historyLimit = 20, clock = Date.now }) {
    this.root = root;
    this.ttl = integer(idleTimeoutMinutes, 'idleTimeoutMinutes', 1, 1440) * 60_000;
    this.historyLimit = integer(historyLimit, 'historyLimit', 0, 1000);
    this.clock = clock;
    this.rootInfo = inspectRoot(root);
    const path = join(root, 'leases.db');
    try { closeSync(openSync(path, 'wx', 0o600)); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const file = lstatSync(path);
    if (!file.isFile() || file.isSymbolicLink() || (process.platform !== 'win32' && ((file.mode & 0o077) || file.uid !== process.getuid()))) {
      fail('UNSAFE_ROOT', 'leases.db must be a regular private file owned by this OS user.');
    }
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
      this.transaction(() => {
        const version = this.db.prepare('PRAGMA user_version').get().user_version;
        if (version > 1) fail('SCHEMA_VERSION', 'This database was created by a newer device-lease version. Upgrade the CLI.');
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS leases (
            device TEXT PRIMARY KEY, owner TEXT NOT NULL, token_hash TEXT NOT NULL,
            purpose TEXT NOT NULL, message TEXT, acquired_at INTEGER NOT NULL,
            last_activity_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ttl_ms INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS handoffs (
            id INTEGER PRIMARY KEY, device TEXT NOT NULL, owner TEXT NOT NULL,
            message TEXT NOT NULL, at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS handoffs_device ON handoffs(device, id);
          CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
          PRAGMA user_version=1;
        `);
      });
    } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  now(write = false) {
    const now = this.clock();
    const last = this.db.prepare("SELECT value FROM metadata WHERE key='last_clock'").get()?.value ?? 0;
    const effective = Math.max(now, last);
    this.clockWarning = now < last ? 'Host clock moved backwards; lease time is frozen until the clock catches up. Holders may still renew or release.' : null;
    if (write) this.db.prepare("INSERT INTO metadata VALUES ('last_clock', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(effective);
    return effective;
  }
  assertNoLegacy() {
    const { legacyLocks } = inspectRoot(this.root);
    if (legacyLocks.length) fail('LEGACY_STATE', 'Legacy lock files exist. Stop all old clients and follow the migration instructions.', { legacyLocks });
  }
  row(device) { return this.db.prepare('SELECT * FROM leases WHERE device=?').get(device); }
  reserve({ device, owner = 'agent', purpose, idleTimeoutMinutes }) {
    text(device, 'device', 512); text(owner, 'owner', 256); text(purpose, 'purpose');
    const ttl = idleTimeoutMinutes === undefined ? this.ttl : integer(idleTimeoutMinutes, 'idleTimeoutMinutes', 1, 1440) * 60_000;
    return this.transaction(() => {
      // Fail closed even for stale legacy locks: old writers must be retired, not auto-migrated.
      this.assertNoLegacy();
      const now = this.now(true);
      const current = this.row(device);
      if (current && now < current.expires_at) fail('BUSY', 'This device already has an active lease.', { holder: publicLease(current) });
      const token = randomBytes(32).toString('hex');
      this.db.prepare(`INSERT OR REPLACE INTO leases VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`)
        .run(device, owner, digest(token), purpose, now, now, now + ttl, ttl);
      return { state: 'reserved', lease: publicLease(this.row(device)), token, reclaimed: Boolean(current),
        previous: publicLease(current) ?? null, lastHandoff: this.history(device, 1)[0] ?? null };
    });
  }
  owned(device, token, now) {
    text(device, 'device', 512); text(token, 'token', 256);
    const row = this.row(device);
    if (!row || row.token_hash !== digest(token) || now >= row.expires_at) {
      fail('LEASE_LOST', 'The lease is absent, expired, or held with another token. Stop using the device.');
    }
    return row;
  }
  heartbeat({ device, token, message }) {
    if (message !== undefined) text(message, 'message');
    return this.transaction(() => {
      this.assertNoLegacy();
      const now = this.now(true), row = this.owned(device, token, now);
      this.db.prepare('UPDATE leases SET last_activity_at=?, expires_at=?, message=? WHERE device=?')
        .run(now, now + row.ttl_ms, message ?? row.message, device);
      return { state: 'heartbeat', lease: publicLease(this.row(device)) };
    });
  }
  release({ device, token, message }) {
    if (message !== undefined) text(message, 'message');
    return this.transaction(() => {
      const now = this.now(true), row = this.owned(device, token, now);
      if (message && this.historyLimit > 0) this.db.prepare('INSERT INTO handoffs(device,owner,message,at) VALUES (?,?,?,?)').run(device, row.owner, message, now);
      if (this.historyLimit > 0) this.db.prepare('DELETE FROM handoffs WHERE device=? AND id NOT IN (SELECT id FROM handoffs WHERE device=? ORDER BY id DESC LIMIT ?)').run(device, device, this.historyLimit);
      this.db.prepare('DELETE FROM leases WHERE device=?').run(device);
      return { state: 'released', device, message: message ?? null };
    });
  }
  history(device, limit = this.historyLimit) {
    return this.db.prepare('SELECT device,owner,message,at FROM handoffs WHERE device=? ORDER BY id DESC LIMIT ?').all(device, limit);
  }
  status(device) {
    // Read the clock and rows from a single snapshot.
    return this.transaction(() => {
      this.assertNoLegacy();
      const now = this.now();
      const rows = device ? [this.row(device)].filter(Boolean) : this.db.prepare('SELECT * FROM leases ORDER BY device').all();
      return { state: 'status', warnings: this.clockWarning ? [this.clockWarning] : [], leases: rows.map(row => ({ ...publicLease(row), state: now >= row.expires_at ? 'expired' : 'reserved' })) };
    });
  }
}
