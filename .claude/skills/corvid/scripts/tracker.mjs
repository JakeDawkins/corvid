#!/usr/bin/env node
// Surgical editor for the PR tracker's data.json.
//
// Every mutating command touches exactly one card, backs the file up first, and
// verifies that no other card changed before writing. Card matching is strict:
// ambiguous or empty matches abort instead of guessing.
//
// Usage: node tracker.mjs <command> [args] [--dry]
//   list [--column NAME] [--hidden] [--all]
//   show <query>
//   columns
//   add-link <query> <url> [--label TEXT] [--first]
//   remove-link <query> <url>
//   set <query> [--title T] [--column C] [--color HEX|none]
//              [--complexity XS|S|M|L|XL|none] [--notes N]
//              [--append-notes N] [--hidden true|false]
//   add-card --title T [--column C] [--link URL]... [--color HEX]
//            [--complexity XS|S|M|L|XL] [--notes N] [--hidden] [--top]
//   add-column <name> [--after EXISTING]
//   validate
//   where                      // print the resolved tasks-data/data.json path and why
//
// The board file is tasks-data/data.json under the repo root. The root is found
// from this script's own location (it ships in .claude/skills/corvid/ inside the
// repo), never from the current directory -- so the command edits the same board
// no matter where it is run from.
//
// Linked git worktrees are rejected: tasks-data/ is git-ignored, so running the
// app from a worktree creates a fresh empty data.json there that looks like a
// valid board but holds nothing. Only the main checkout is a real board.
//
// Env: PR_TRACKER_DIR overrides the project directory (the file is still
// tasks-data/data.json under it); --data PATH overrides the full data.json path.
// Either override still has to pass the location checks unless
// --allow-nonstandard is also passed.

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  copyFileSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const argv = process.argv.slice(2);
const cmd = argv.shift();

function flag(name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) return true;
  argv.splice(i, 2);
  return v;
}
function bareFlag(name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return false;
  argv.splice(i, 1);
  return true;
}
function allFlags(name) {
  const out = [];
  for (;;) {
    const v = flag(name);
    if (v === undefined) break;
    out.push(v);
  }
  return out;
}

const DRY = bareFlag('dry');
const ALLOW_NONSTANDARD = bareFlag('allow-nonstandard');
// This script lives at <repo>/.claude/skills/corvid/scripts/tracker.mjs, so the
// repo root is four levels up. Deriving it from the script keeps the skill
// portable: clone the repo anywhere and the default target follows it.
const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const CANONICAL_DIR = resolve(SKILL_DIR, '..', '..', '..', '..');
const BACKUP_DIR = join(homedir(), '.pr-tracker-backups');
const KEEP_BACKUPS = 20;

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// Resolve the data.json path from explicit flag > env > the canonical checkout.
// Never from process.cwd(), so running this from a git worktree or anywhere
// else still edits the one real board.
// The board file lives at <checkout root>/tasks-data/data.json. The root is the
// canonical checkout (or PR_TRACKER_DIR); only the child path moved under
// tasks-data/ so it can be synced on its own without node_modules et al.
function resolveDataPath() {
  const explicit = flag('data');
  if (typeof explicit === 'string') {
    const path = resolve(explicit);
    return { path, root: dirname(path), source: '--data' };
  }
  const env = process.env.PR_TRACKER_DIR;
  if (env) {
    const root = resolve(env);
    return { path: join(root, 'tasks-data', 'data.json'), root, source: 'PR_TRACKER_DIR' };
  }
  return {
    path: join(CANONICAL_DIR, 'tasks-data', 'data.json'),
    root: CANONICAL_DIR,
    source: 'canonical',
  };
}

// A decoy data.json is any copy outside the main checkout: a linked git
// worktree or a stray clone. Writing one edits nothing the user can see, so
// refuse rather than silently succeed.
// True when `dir` is a linked git worktree rather than the main checkout. Git
// reports a different --git-dir and --git-common-dir in that case. A worktree's
// tasks-data/ is git-ignored and therefore empty or absent, so its data.json is
// a decoy even though the skill ships alongside it.
function isLinkedWorktree(dir) {
  try {
    const run = (args) =>
      execSync(`git -C ${JSON.stringify(dir)} rev-parse --path-format=absolute ${args} 2>/dev/null`, {
        encoding: 'utf8',
      }).trim();
    const gitDir = run('--git-dir');
    const commonDir = run('--git-common-dir');
    return Boolean(gitDir) && Boolean(commonDir) && gitDir !== commonDir;
  } catch {
    return false;
  }
}

function guardDataPath({ path, root, source }) {
  let realDir = root;
  try {
    realDir = realpathSync(root);
  } catch {
    die(`project directory does not exist: ${root}${source === 'canonical' ? '' : ` (from ${source})`}`);
  }

  // The one location that is never right: a linked worktree. An explicit
  // --data/PR_TRACKER_DIR pointing at any other checkout is a deliberate act and
  // is honoured, since a board can legitimately live in a different clone.
  if (isLinkedWorktree(realDir) && !ALLOW_NONSTANDARD) {
    const hint =
      source === 'canonical'
        ? '  Point PR_TRACKER_DIR at the checkout that holds the real board, or pass\n  --allow-nonstandard if you really mean this copy.'
        : `  ${source} points at a worktree. Point it at the main checkout instead, or pass\n  --allow-nonstandard if you really mean this copy.`;
    die(
      `refusing to use ${path}\n  because ${realDir} is a linked git worktree, not the main checkout.\n` +
        `  tasks-data/ is git-ignored, so a worktree's data.json is empty or absent -- running\n` +
        `  the app there creates a decoy board.\n${hint}`,
    );
  }
  return path;
}

const RESOLVED = resolveDataPath();
const DATA_PATH = guardDataPath(RESOLVED);

// Echo the target on every run so a wrong file is obvious before anything else
// is read into the conversation.
function printTarget() {
  console.log(`# data: ${DATA_PATH} (${RESOLVED.source})`);
}

function load() {
  let raw;
  try {
    raw = readFileSync(DATA_PATH, 'utf8');
  } catch (e) {
    die(`cannot read ${DATA_PATH}: ${e.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    die(`${DATA_PATH} is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(data.cards)) die('data.json has no cards array');
  if (!Array.isArray(data.columns)) die('data.json has no columns array');
  return data;
}

// Matches the server's write format exactly (JSON.stringify(data, null, 2),
// no trailing newline) so external edits leave no formatting churn.
function serialize(data) {
  return JSON.stringify(data, null, 2);
}

function backup() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(BACKUP_DIR, `data.${stamp}.json`);
  copyFileSync(DATA_PATH, dest);
  const old = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('data.') && f.endsWith('.json'))
    .sort()
    .slice(0, -KEEP_BACKUPS);
  for (const f of old) unlinkSync(join(BACKUP_DIR, f));
  return dest;
}

// Guard against collateral damage: everything except the one target card must
// serialize identically before and after.
function assertOnlyTouched(beforeData, afterData, cardId) {
  const strip = (d) => ({
    ...d,
    cards: d.cards.filter((c) => c.id !== cardId).map((c) => JSON.stringify(c)),
  });
  const a = JSON.stringify(strip(beforeData));
  const b = JSON.stringify(strip(afterData));
  if (a !== b) die('refusing to write: the change would affect more than the target card');
  const order = (d) => d.cards.map((c) => c.id).filter((id) => id !== cardId).join(',');
  if (order(beforeData) !== order(afterData))
    die('refusing to write: the change would reorder other cards');
}

function appRunning() {
  for (const port of [8787, 5473]) {
    try {
      const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null`, {
        encoding: 'utf8',
      }).trim();
      if (out) return port;
    } catch {}
  }
  return null;
}

function commit(before, data, cardId, summary) {
  const beforeParsed = JSON.parse(before);
  assertOnlyTouched(beforeParsed, data, cardId);
  const next = serialize(data);
  if (next === before) {
    console.log('no change (data.json already matches the requested state)');
    return;
  }
  writeAndReport(next, summary);
}

// Back up, write, and report. Shared by the card and column commit paths so the
// backup/reporting behaviour can't drift between them.
function writeAndReport(next, summary) {
  if (DRY) {
    console.log('--- DRY RUN, nothing written ---');
    console.log(summary);
    return;
  }
  const dest = backup();
  mkdirSync(dirname(DATA_PATH), { recursive: true });
  writeFileSync(DATA_PATH, next);
  console.log(summary);
  console.log(`wrote ${DATA_PATH}`);
  console.log(`backup ${dest}`);
  const port = appRunning();
  if (port)
    console.log(
      `NOTE: the tracker app is running (port ${port}). It watches data.json and reloads ` +
        `this change on its own. The one exception is an edit made in the browser in the same ` +
        `moment: the page's own unsaved state wins and would overwrite this write.`,
    );
}

// Guard for a columns[] change: no card may be touched, and every pre-existing
// column must survive in its original relative order. Only additions pass.
function assertColumnsOnly(beforeData, afterData) {
  if (JSON.stringify(beforeData.cards) !== JSON.stringify(afterData.cards))
    die('refusing to write: the change would modify cards');
  const kept = afterData.columns.filter((c) => beforeData.columns.includes(c));
  if (JSON.stringify(kept) !== JSON.stringify(beforeData.columns))
    die('refusing to write: the change would remove or reorder existing columns');
}

function commitColumns(before, data, summary) {
  assertColumnsOnly(JSON.parse(before), data);
  const next = serialize(data);
  if (next === before) {
    console.log('no change (data.json already matches the requested state)');
    return;
  }
  writeAndReport(next, summary);
}

const short = (id) => id.slice(0, 8);

function cardLine(c, i) {
  const bits = [
    short(c.id),
    `[${c.column}]`,
    c.hidden ? '(hidden)' : '',
    JSON.stringify(c.title),
    `${c.links.length} link${c.links.length === 1 ? '' : 's'}`,
    c.color ? c.color : '',
    c.complexity ? c.complexity : '',
  ].filter(Boolean);
  return `${String(i).padStart(3)}  ${bits.join('  ')}`;
}

// A query matches a card by: exact id, id prefix (>=4 chars), a case-insensitive
// substring of the title, or a substring of any of its link URLs. Exactly one
// card must match; 0 or 2+ is an error listing the candidates.
function findCard(data, query) {
  if (!query) die('missing card query');
  const q = String(query).toLowerCase();
  const byId = data.cards.filter((c) => c.id === query);
  if (byId.length === 1) return byId[0];
  const idPrefix = q.length >= 4 ? data.cards.filter((c) => c.id.toLowerCase().startsWith(q)) : [];
  if (idPrefix.length === 1) return idPrefix[0];
  const byTitle = data.cards.filter((c) => String(c.title).toLowerCase().includes(q));
  const byLink = data.cards.filter((c) =>
    (c.links || []).some((l) => String(l.url).toLowerCase().includes(q)),
  );
  const hits = [...new Set([...idPrefix, ...byTitle, ...byLink])];
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) die(`no card matches ${JSON.stringify(query)}`);
  console.error(`error: ${hits.length} cards match ${JSON.stringify(query)}; be more specific:`);
  hits.forEach((c, i) => console.error('  ' + cardLine(c, i)));
  process.exit(1);
}

function linkKind(url) {
  const s = String(url);
  if (/github\.com\/[^/]+\/[^/]+\/pull\/\d+/i.test(s)) return 'pr';
  if (/linear\.app\/[^/]+\/issue\/[A-Za-z0-9]+-\d+/i.test(s) || /linear\.app\/[^/]+\/project\//i.test(s))
    return 'linear';
  return 'generic';
}

function requireColumn(data, column) {
  if (!data.columns.includes(column))
    die(`column ${JSON.stringify(column)} does not exist. Columns: ${data.columns.join(' | ')}`);
}

const COMPLEXITY = ['XS', 'S', 'M', 'L', 'XL'];

// Complexity is a t-shirt size (XS|S|M|L|XL), stored uppercase. "none"/"" clears
// it (the card then shows no meter). Input is case-insensitive.
function normalizeComplexity(value) {
  if (value === 'none' || value === '') return undefined;
  const up = String(value).toUpperCase();
  if (!COMPLEXITY.includes(up))
    die(`--complexity must be one of ${COMPLEXITY.join(' | ')}, or "none"`);
  return up;
}

function normalizeColor(value, data) {
  if (value === 'none' || value === '') return undefined;
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    const known = Object.entries(data.colorTags || {});
    const tag = known.find(([, name]) => String(name).toLowerCase() === value.toLowerCase());
    if (tag) return tag[0];
    die(`--color must be a #rrggbb hex value, "none", or a known color tag (${known.map(([h, n]) => `${n}=${h}`).join(', ')})`);
  }
  return value.toLowerCase();
}

switch (cmd) {
  case 'where': {
    printTarget();
    console.log(`repo root (from this script's location): ${CANONICAL_DIR}`);
    console.log(`PR_TRACKER_DIR: ${process.env.PR_TRACKER_DIR ?? '(unset)'}`);
    console.log(`cwd (never used to resolve the path): ${process.cwd()}`);
    console.log(existsSync(DATA_PATH) ? 'file exists' : 'file does NOT exist');
    if (existsSync(DATA_PATH)) {
      const d = load();
      console.log(`${d.cards.length} cards, ${d.columns.length} columns`);
    }
    break;
  }
  case 'list': {
    printTarget();
    const data = load();
    const column = flag('column');
    const onlyHidden = bareFlag('hidden');
    const all = bareFlag('all');
    let cards = data.cards;
    if (column) {
      requireColumn(data, column);
      cards = cards.filter((c) => c.column === column);
    }
    if (onlyHidden) cards = cards.filter((c) => c.hidden);
    else if (!all) cards = cards.filter((c) => !c.hidden);
    cards.forEach((c, i) => console.log(cardLine(c, i)));
    console.log(`\n${cards.length} card(s) shown of ${data.cards.length} total`);
    break;
  }
  case 'columns': {
    printTarget();
    const data = load();
    for (const col of data.columns) {
      const n = data.cards.filter((c) => c.column === col && !c.hidden).length;
      const h = data.cards.filter((c) => c.column === col && c.hidden).length;
      console.log(`${col}  —  ${n} visible${h ? `, ${h} hidden` : ''}`);
    }
    const tags = Object.entries(data.colorTags || {});
    if (tags.length) console.log(`\ncolor tags: ${tags.map(([h, n]) => `${n} (${h})`).join(', ')}`);
    break;
  }
  case 'show': {
    printTarget();
    const data = load();
    const card = findCard(data, argv.shift());
    console.log(JSON.stringify(card, null, 2));
    for (const l of card.links) console.log(`  ${linkKind(l.url)}: ${l.url}`);
    break;
  }
  case 'add-link': {
    printTarget();
    const before = readFileSync(DATA_PATH, 'utf8');
    const data = load();
    const query = argv.shift();
    const url = argv.shift();
    const label = flag('label');
    const first = bareFlag('first');
    if (!url || url.startsWith('--')) die('missing url');
    const card = findCard(data, query);
    if (card.links.some((l) => l.url === url)) {
      console.log(`card ${short(card.id)} already has ${url}`);
      break;
    }
    const link = { label: typeof label === 'string' ? label : '', url };
    if (first) card.links.unshift(link);
    else card.links.push(link);
    commit(
      before,
      data,
      card.id,
      `added ${linkKind(url)} link to ${short(card.id)} ${JSON.stringify(card.title)}:\n  ${url}`,
    );
    break;
  }
  case 'remove-link': {
    printTarget();
    const before = readFileSync(DATA_PATH, 'utf8');
    const data = load();
    const card = findCard(data, argv.shift());
    const url = argv.shift();
    if (!url || url.startsWith('--')) die('missing url');
    const matches = card.links.filter((l) => l.url === url || l.url.includes(url));
    if (matches.length === 0) die(`card ${short(card.id)} has no link matching ${url}`);
    if (matches.length > 1)
      die(`${matches.length} links on ${short(card.id)} match ${url}; pass the full URL`);
    card.links = card.links.filter((l) => l !== matches[0]);
    commit(before, data, card.id, `removed link from ${short(card.id)}:\n  ${matches[0].url}`);
    break;
  }
  case 'set': {
    printTarget();
    const before = readFileSync(DATA_PATH, 'utf8');
    const data = load();
    const card = findCard(data, argv.shift());
    const title = flag('title');
    const column = flag('column');
    const color = flag('color');
    const complexity = flag('complexity');
    const notes = flag('notes');
    const appendNotes = flag('append-notes');
    const hidden = flag('hidden');
    const changes = [];
    if (typeof title === 'string') {
      changes.push(`title: ${JSON.stringify(card.title)} -> ${JSON.stringify(title)}`);
      card.title = title;
    }
    if (typeof column === 'string') {
      requireColumn(data, column);
      changes.push(`column: ${card.column} -> ${column}`);
      card.column = column;
    }
    if (typeof color === 'string') {
      const next = normalizeColor(color, data);
      changes.push(`color: ${card.color ?? 'none'} -> ${next ?? 'none'}`);
      if (next === undefined) delete card.color;
      else card.color = next;
    }
    if (typeof complexity === 'string') {
      const next = normalizeComplexity(complexity);
      changes.push(`complexity: ${card.complexity ?? 'none'} -> ${next ?? 'none'}`);
      if (next === undefined) delete card.complexity;
      else card.complexity = next;
    }
    if (typeof notes === 'string') {
      changes.push(`notes replaced (${(card.notes || '').length} -> ${notes.length} chars)`);
      card.notes = notes;
    }
    if (typeof appendNotes === 'string') {
      card.notes = card.notes ? `${card.notes}\n${appendNotes}` : appendNotes;
      changes.push(`notes appended (+${appendNotes.length} chars)`);
    }
    if (typeof hidden === 'string' || hidden === true) {
      const v = hidden === true ? true : hidden === 'true';
      if (hidden !== true && hidden !== 'true' && hidden !== 'false')
        die('--hidden takes true or false');
      changes.push(`hidden: ${card.hidden} -> ${v}`);
      card.hidden = v;
    }
    if (!changes.length) die('set needs at least one of --title --column --color --complexity --notes --append-notes --hidden');
    commit(before, data, card.id, `updated ${short(card.id)} ${JSON.stringify(card.title)}:\n  ${changes.join('\n  ')}`);
    break;
  }
  case 'add-card': {
    printTarget();
    const before = readFileSync(DATA_PATH, 'utf8');
    const data = load();
    const title = flag('title');
    const column = flag('column') || data.columns[0];
    const color = flag('color');
    const complexity = flag('complexity');
    const notes = flag('notes');
    const top = bareFlag('top');
    const hidden = bareFlag('hidden');
    const links = allFlags('link');
    if (typeof title !== 'string' || !title.trim()) die('add-card requires --title');
    requireColumn(data, column);
    const card = {
      id: crypto.randomUUID(),
      title,
      column,
      hidden,
      notes: typeof notes === 'string' ? notes : '',
      links: links.map((url) => ({ label: '', url })),
    };
    if (typeof color === 'string') {
      const next = normalizeColor(color, data);
      if (next) card.color = next;
    }
    if (typeof complexity === 'string') {
      const next = normalizeComplexity(complexity);
      if (next) card.complexity = next;
    }
    // Card array order is the in-column display order, so append by default and
    // only jump the queue when asked.
    if (top) {
      const firstInColumn = data.cards.findIndex((c) => c.column === column);
      if (firstInColumn === -1) data.cards.push(card);
      else data.cards.splice(firstInColumn, 0, card);
    } else {
      let lastInColumn = -1;
      data.cards.forEach((c, i) => {
        if (c.column === column) lastInColumn = i;
      });
      if (lastInColumn === -1) data.cards.push(card);
      else data.cards.splice(lastInColumn + 1, 0, card);
    }
    commit(
      before,
      data,
      card.id,
      `added card ${short(card.id)} ${JSON.stringify(title)} to [${column}]` +
        (card.links.length ? `\n  ${card.links.map((l) => l.url).join('\n  ')}` : ''),
    );
    break;
  }
  case 'add-column': {
    printTarget();
    const before = readFileSync(DATA_PATH, 'utf8');
    const data = load();
    const after = flag('after');
    const name = argv.shift();
    if (typeof name !== 'string' || !name.trim()) die('add-column requires a column name');
    const trimmed = name.trim();
    const clash = data.columns.find((c) => c.toLowerCase() === trimmed.toLowerCase());
    if (clash)
      die(
        `column ${JSON.stringify(clash)} already exists` +
          (clash === trimmed ? '' : ` (differs only in case from ${JSON.stringify(trimmed)})`),
      );
    // Append by default. Position 0 is deliberately not offered: the app's
    // quick-add button and this script's add-card both fall back to columns[0],
    // so a new empty column there would start swallowing new cards.
    let index = data.columns.length;
    if (typeof after === 'string') {
      requireColumn(data, after);
      index = data.columns.indexOf(after) + 1;
    }
    data.columns.splice(index, 0, trimmed);
    commitColumns(
      before,
      data,
      `added column ${JSON.stringify(trimmed)} at position ${index + 1} of ${data.columns.length}\n` +
        `  columns: ${data.columns.join(' | ')}`,
    );
    break;
  }
  case 'validate': {
    printTarget();
    const data = load();
    const problems = [];
    const seen = new Set();
    for (const c of data.cards) {
      const where = `${short(c.id || '????????')} ${JSON.stringify(c.title)}`;
      if (!c.id) problems.push(`${where}: missing id`);
      if (seen.has(c.id)) problems.push(`${where}: duplicate id`);
      seen.add(c.id);
      if (typeof c.title !== 'string') problems.push(`${where}: title is not a string`);
      if (typeof c.hidden !== 'boolean') problems.push(`${where}: hidden is not a boolean`);
      if (!data.columns.includes(c.column)) problems.push(`${where}: unknown column ${c.column}`);
      if (!Array.isArray(c.links)) problems.push(`${where}: links is not an array`);
      else {
        const urls = new Set();
        for (const l of c.links) {
          if (typeof l?.url !== 'string' || typeof l?.label !== 'string')
            problems.push(`${where}: link must be {label, url}: ${JSON.stringify(l)}`);
          else if (urls.has(l.url)) problems.push(`${where}: duplicate link ${l.url}`);
          else urls.add(l.url);
        }
      }
      if (c.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(c.color))
        problems.push(`${where}: bad color ${c.color}`);
      if (c.complexity !== undefined && !COMPLEXITY.includes(c.complexity))
        problems.push(`${where}: bad complexity ${c.complexity}`);
    }
    if (problems.length) {
      console.error(problems.map((p) => `- ${p}`).join('\n'));
      console.error(`\n${problems.length} problem(s)`);
      process.exit(1);
    }
    console.log(`ok: ${data.cards.length} cards, ${data.columns.length} columns, valid JSON`);
    break;
  }
  default:
    console.error(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 24).join('\n').replace(/^\/\/ ?/gm, ''));
    process.exit(cmd ? 1 : 0);
}
