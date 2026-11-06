#!/usr/bin/env node
// SPDX-License-Identifier: MIT
const [major, minor] = process.versions.node.split('.').map(Number);
function runtimeError(message) {
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, code: 'RUNTIME', message }));
  else console.error(message);
  process.exitCode = 70;
}
if (major < 22 || (major === 22 && minor < 13) || (major === 23 && minor < 4)) {
  runtimeError('device-lease requires Node.js 22.13+ (22.x), or 23.4+. Install a supported LTS version.');
} else {
  try { await import('./main.mjs'); }
  catch (error) { runtimeError(`Cannot load device-lease: ${error.message}`); }
}
