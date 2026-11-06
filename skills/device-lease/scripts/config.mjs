// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fail, integer, text } from './lease.mjs';

export function absolute(value, name, home = homedir()) {
  text(value, name, 4096);
  const path = value === '~' ? home : value.startsWith('~/') ? join(home, value.slice(2)) : value;
  if (!isAbsolute(path)) fail('USAGE', `${name} must be absolute (or start with ~/).`);
  return path;
}
export function loadConfig(flags = {}, env = process.env, home = homedir(), allowMissing = false) {
  const explicit = flags.config ?? env.DEVICE_LEASE_CONFIG;
  const configPath = absolute(explicit ?? join(home, '.config', 'device-lease', 'config.json'), 'config path', home);
  let config = {};
  try { config = JSON.parse(readFileSync(configPath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT' || (explicit && !allowMissing)) fail('CONFIG', `Cannot read config ${configPath}: ${error.message}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('CONFIG', 'Configuration must be a JSON object.');
  const allowed = ['root', 'idleTimeoutMinutes', 'historyLimit', 'devices', 'strictDevices'];
  for (const key of Object.keys(config)) if (!allowed.includes(key)) fail('CONFIG', `Unknown configuration field: ${key}`);
  const devices = config.devices ?? {};
  if (!devices || typeof devices !== 'object' || Array.isArray(devices)) fail('CONFIG', 'devices must be a map of labels to canonical device IDs.');
  for (const [label, id] of Object.entries(devices)) { text(label, 'device label', 512); text(id, 'canonical device ID', 512); }
  // Prevent chains/cycles and ambiguous IDs. Multiple aliases for the same ID are fine.
  for (const id of Object.values(devices)) if (Object.hasOwn(devices, id) && devices[id] !== id) fail('CONFIG', 'A canonical device ID cannot alias another device ID.');
  if (config.strictDevices !== undefined && typeof config.strictDevices !== 'boolean') fail('CONFIG', 'strictDevices must be a boolean.');
  return {
    configPath,
    root: absolute(flags.root ?? env.DEVICE_LEASE_ROOT ?? config.root ?? join(home, '.device-leases'), 'state root', home),
    idleTimeoutMinutes: integer(flags['idle-timeout-minutes'] ?? env.DEVICE_LEASE_IDLE_TIMEOUT_MINUTES ?? config.idleTimeoutMinutes ?? 15, 'idleTimeoutMinutes', 1, 1440),
    historyLimit: integer(flags['history-limit'] ?? env.DEVICE_LEASE_HISTORY_LIMIT ?? config.historyLimit ?? 20, 'historyLimit', 0, 1000),
    devices,
    strictDevices: config.strictDevices ?? Object.keys(devices).length > 0,
  };
}
export function resolveDevice(value, config) {
  text(value, 'device', 512);
  if (config.strictDevices && !Object.hasOwn(config.devices, value) && !Object.values(config.devices).includes(value)) fail('CONFIG', `Unknown device ${value}; choose a configured alias or canonical ID.`);
  return Object.hasOwn(config.devices, value) ? config.devices[value] : value;
}
