#!/usr/bin/env node
// One-off migration: rename every card's hiddenAt to archivedAt, keeping the
// key in the same position. If a card somehow has both, archivedAt wins and
// hiddenAt is dropped. Safe to run more than once: a board with no hiddenAt
// left is not written.
//
// Usage: node scripts/rename-hidden-at.mjs [path/to/data.json] [--dry]
// Defaults to tasks-data/data.json under the repo this script is in. Before
// writing, copies the whole file to data.backup-<timestamp>.json next to it.

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const pathArg = args.find((a) => !a.startsWith('--'));
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = resolve(pathArg ?? join(root, 'tasks-data', 'data.json'));

const raw = readFileSync(dataPath, 'utf8');
const data = JSON.parse(raw);
if (!Array.isArray(data.cards)) throw new Error(`${dataPath} has no cards array`);

let renamed = 0;
let dropped = 0;
data.cards = data.cards.map((card) => {
  if (!('hiddenAt' in card)) return card;
  if ('archivedAt' in card) {
    dropped++;
    const { hiddenAt, ...rest } = card;
    return rest;
  }
  renamed++;
  return Object.fromEntries(Object.entries(card).map(([k, v]) => [k === 'hiddenAt' ? 'archivedAt' : k, v]));
});

console.log(
  `${dataPath}: ${renamed} of ${data.cards.length} cards ${dry ? 'would get' : 'got'} hiddenAt renamed to archivedAt` +
    (dropped ? `, ${dropped} already had archivedAt and ${dry ? 'would drop' : 'dropped'} hiddenAt` : ''),
);
if (dry || !(renamed + dropped)) process.exit(0);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = join(dirname(dataPath), `data.backup-${stamp}.json`);
copyFileSync(dataPath, backup);
console.log(`backup ${backup}`);
// Same format as the server's writes: 2-space JSON, no trailing newline.
writeFileSync(dataPath, JSON.stringify(data, null, 2));
console.log(`wrote ${dataPath}`);
