#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { LeaseStore, LeaseError, fail } from './lease.mjs';
import { loadConfig, resolveDevice } from './config.mjs';

const usage = `device-lease — cooperative device leases on one host

Requires Node.js >=22.13. Local filesystem, one OS account, one state root.

Commands:
  init       Write a starter config without overwriting an existing file
  doctor     Check state permissions, SQLite integrity, and conflicting locks
  reserve    --device <canonical-ID-or-alias> --purpose <text> [--owner <label>]
  heartbeat  --device <ID-or-alias> [--message <text>] + token
  release    --device <ID-or-alias> [--message <handoff>] + token
  status     [--device <ID-or-alias>]
  history    --device <ID-or-alias>

Common options:
  --config <absolute-path>       JSON config; default ~/.config/device-lease/config.json
  --root <absolute-path>         Shared local state; default ~/.device-leases
  --idle-timeout-minutes <1-1440> New lease TTL; default 15
  --history-limit <0-1000>       Handoffs retained per device; default 20
  --json                        Machine-readable results and errors on stdout
  --token-stdin                 Read token from stdin (preferred for automation)
  --token <value>               Token in arguments (visible in process listings)
  --help                        Show usage

Environment: DEVICE_LEASE_CONFIG, DEVICE_LEASE_ROOT,
DEVICE_LEASE_IDLE_TIMEOUT_MINUTES, DEVICE_LEASE_HISTORY_LIMIT,
DEVICE_LEASE_OWNER, DEVICE_LEASE_TOKEN.
Precedence: flag > environment > config > default.
Tokens are printed only by reserve. Stop device use immediately on LEASE_LOST.
Exit codes: 0 success; 2 device busy; 3 lease lost; 64 usage/config;
70 storage/safety failure; 75 database busy (ownership unconfirmed).
`;

export function parse(argv) {
  const flags = {}, positional = [];
  const booleans = new Set(['json', 'help', 'token-stdin']);
  const values = new Set(['config', 'root', 'device', 'purpose', 'owner', 'token', 'message', 'idle-timeout-minutes', 'history-limit']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h') { flags.help = true; continue; }
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const split = arg.indexOf('=');
    const key = arg.slice(2, split < 0 ? undefined : split);
    if (Object.hasOwn(flags, key)) fail('USAGE', `Duplicate option --${key}.`);
    if (booleans.has(key) && split < 0) { flags[key] = true; continue; }
    if (!values.has(key)) fail('USAGE', `Unknown option ${arg}.`);
    const value = split < 0 ? argv[++i] : arg.slice(split + 1);
    if (value === undefined || (split < 0 && value.startsWith('--'))) fail('USAGE', `--${key} requires a value. Use --${key}=value for text beginning with --.`);
    flags[key] = value;
  }
  if (positional.length > 1) fail('USAGE', 'Specify a single command.');
  return { command: positional[0] ?? 'status', flags };
}
async function readToken(flags) {
  if (flags.token !== undefined && flags['token-stdin']) fail('USAGE', 'Choose --token or --token-stdin, not both.');
  if (!flags['token-stdin']) return flags.token ?? process.env.DEVICE_LEASE_TOKEN;
  if (process.stdin.isTTY) fail('USAGE', 'Pipe a token into --token-stdin; interactive token entry is unsupported.');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 256) fail('USAGE', 'Token input is too long.');
  }
  return input.trim();
}
const exitFor = code => code === 'BUSY' ? 2 : code === 'DB_BUSY' ? 75 : code === 'LEASE_LOST' ? 3 : ['USAGE', 'CONFIG'].includes(code) ? 64 : 70;

async function main() {
  const { command, flags } = parse(process.argv.slice(2));
  if (flags.help || command === 'help') { console.log(flags.json ? JSON.stringify({ok:true,state:'help',usage}) : usage); return; }
  if (!['init', 'doctor', 'reserve', 'heartbeat', 'release', 'status', 'history'].includes(command)) fail('USAGE', `Unknown command ${command}.`);
  const common = ['config', 'root', 'idle-timeout-minutes', 'history-limit', 'json', 'help'];
  const perCommand = { init: [], doctor: [], reserve: ['device','purpose','owner'], heartbeat: ['device','token','token-stdin','message'], release: ['device','token','token-stdin','message'], status: ['device'], history: ['device'] };
  for (const key of Object.keys(flags)) if (![...common, ...perCommand[command]].includes(key)) fail('USAGE', `--${key} is not valid for ${command}.`);
  const config = loadConfig(flags, process.env, homedir(), command === 'init');
  let result;
  if (command === 'init') {
    mkdirSync(dirname(config.configPath), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(config.configPath, JSON.stringify({root: config.root, idleTimeoutMinutes: config.idleTimeoutMinutes, historyLimit: config.historyLimit, devices: {}}, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    } catch (error) { if (error.code === 'EEXIST') fail('CONFIG', 'Configuration already exists; init will not overwrite it.'); throw error; }
    result = { state: 'initialized', config: config.configPath, root: config.root };
  } else {
    const device = flags.device === undefined ? undefined : resolveDevice(flags.device, config);
    if (['reserve', 'heartbeat', 'release', 'history'].includes(command) && !device) fail('USAGE', '--device is required.');
    const token = ['heartbeat', 'release'].includes(command) ? await readToken(flags) : undefined;
    if (['heartbeat', 'release'].includes(command) && !token) fail('USAGE', 'Supply a lease token through stdin, environment, or --token.');
    if (command === 'reserve' && !flags.purpose) fail('USAGE', '--purpose is required.');
    const store = new LeaseStore(config);
    try {
      if (command === 'reserve') result = store.reserve({ device, purpose: flags.purpose, owner: flags.owner ?? process.env.DEVICE_LEASE_OWNER ?? 'agent' });
      else if (command === 'heartbeat' || command === 'release') result = store[command]({ device, token, message: flags.message });
      else if (command === 'status') result = store.status(device);
      else if (command === 'history') result = { state: 'history', device, handoffs: store.history(device) };
      else {
        store.transaction(() => store.now());
        const integrity = store.db.prepare('PRAGMA quick_check').get().quick_check;
        if (integrity !== 'ok') fail('CORRUPT_STATE', 'SQLite integrity check failed; stop all clients before restoring state.');
        const legacyLocks = store.rootInfo.legacyLocks;
        result = { state: 'doctor', root: config.root, config: config.configPath, node: process.version, schemaVersion: 1, integrity, filesystemType: store.rootInfo.filesystemType,
          legacyLocks, warnings: [...(store.clockWarning ? [store.clockWarning] : []), 'Filesystem-type rejection is Linux-only (plus Windows UNC rejection). Confirm that state is on a local, non-synced disk.', 'Leases are advisory; all clients must use this exact root and canonical IDs.'] };
        if (legacyLocks.length) fail('LEGACY_STATE', 'Conflicting lock entries exist in the state root. Identify the other lease clients and resolve the conflict before continuing.', result);
      }
    } finally { store.close(); }
  }
  if (flags.json) console.log(JSON.stringify({ ok: true, ...result }));
  else console.log(JSON.stringify(result, null, 2));
}
main().catch(error => {
  const code = error instanceof LeaseError ? error.code : /database is (locked|busy)/i.test(error.message) ? 'DB_BUSY' : /not a database|malformed/i.test(error.message) ? 'CORRUPT_STATE' : 'STORAGE';
  const result = { ok: false, code, message: error.message, ...(error.details ? { details: error.details } : {}) };
  if (process.argv.includes('--json')) console.log(JSON.stringify(result));
  else console.error(`${code}: ${error.message}`);
  process.exitCode = exitFor(code);
});
