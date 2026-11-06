#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Optional OpenSSH forced command: parse JSON, never evaluate a remote shell string.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';

try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--config' || !isAbsolute(args[1])) throw new Error('Forced command requires --config <absolute-path>.');
  const raw = process.env.SSH_ORIGINAL_COMMAND ?? '';
  if (raw.length > 8192) throw new Error('Request is too large.');
  const request = JSON.parse(raw);
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Request must be a JSON object.');
  const commands = {reserve:['device','purpose','owner'],heartbeat:['device','message'],release:['device','message'],status:['device'],history:['device'],doctor:[]};
  if (!Object.hasOwn(commands, request.command)) throw new Error('Unsupported lease command.');
  const argv = [fileURLToPath(new URL('../skills/device-lease/scripts/cli.mjs',import.meta.url)),request.command,`--config=${args[1]}`,'--json'];
  for (const [key,value] of Object.entries(request)) {
    if (key === 'command') continue;
    if (!commands[request.command].includes(key) || typeof value !== 'string') throw new Error(`Unsupported request field: ${key}`);
    argv.push(`--${key}=${value}`);
  }
  if (['heartbeat','release'].includes(request.command)) argv.push('--token-stdin');
  const env = {...process.env};
  for (const key of Object.keys(env)) if (key.startsWith('DEVICE_LEASE_')) delete env[key];
  const result = spawnSync(process.execPath,argv,{env,stdio:'inherit'});
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 70;
} catch (error) {
  console.log(JSON.stringify({ok:false,code:'USAGE',message:error.message}));
  process.exitCode = 64;
}
