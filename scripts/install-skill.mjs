#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { cpSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';

// Deliberately explicit: no automatic writes to either agent's global configuration.
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--target' || !isAbsolute(args[1])) {
  console.error('Usage: node scripts/install-skill.mjs --target <absolute-path-to-new-device-lease-folder>');
  process.exit(64);
}
const target = args[1];
const source = fileURLToPath(new URL('../skills/device-lease/', import.meta.url));
mkdirSync(dirname(target), { recursive: true });
let created = false;
try {
  mkdirSync(target); // Exclusive; existing directories and symlinks must not be overwritten.
  created = true;
  for (const name of readdirSync(source)) cpSync(join(source, name), join(target, name), { recursive: true, force: false, errorOnExist: true });
  console.log(`Installed ${target}. Restart the agent session to discover the skill.`);
} catch (error) {
  if (created) rmSync(target, { recursive: true, force: true });
  console.error(`Installation refused: ${error.message}`);
  process.exitCode = 1;
}
