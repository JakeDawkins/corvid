#!/usr/bin/env node
// One-off migration: give every card a createdAt and updatedAt of now where it
// has none. archivedAt is left unset on cards that are already hidden, so they
// keep their current order at the bottom of the Hidden column. Safe to run
// more than once: cards that already have a timestamp keep it.
//
// Usage: node scripts/migrate-card-timestamps.mjs [path/to/data.json] [--dry]
// Defaults to tasks-data/data.json under the repo this script is in. Backs the
// file up to ~/.corvid-backups first, like the corvid skill's tracker.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const pathArg = args.find((a) => !a.startsWith('--'));
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = resolve(pathArg ?? join(root, 'tasks-data', 'data.json'));

const raw = readFileSync(dataPath, 'utf8');
const data = JSON.parse(raw);
if (!Array.isArray(data.cards)) throw new Error(`${dataPath} has no cards array`);

const now = new Date().toISOString();
let changed = 0;
for (const card of data.cards) {
  const before = JSON.stringify(card);
  card.createdAt ??= now;
  card.updatedAt ??= now;
  if (!card.hidden) delete card.archivedAt;
  if (JSON.stringify(card) !== before) changed++;
}

console.log(`${dataPath}: ${changed} of ${data.cards.length} cards ${dry ? 'would get' : 'got'} timestamps`);
if (dry || !changed) process.exit(0);

const backupDir = join(homedir(), '.corvid-backups');
mkdirSync(backupDir, { recursive: true });
const backup = join(backupDir, `data.${now.replace(/[:.]/g, '-')}.json`);
copyFileSync(dataPath, backup);
// Same format as the server's writes: 2-space JSON, no trailing newline.
writeFileSync(dataPath, JSON.stringify(data, null, 2));
console.log(`backup ${backup}`);
