#!/usr/bin/env node
// Surgical editor for the Corvid board's data.json.
//
// Every mutating command touches exactly one card, backs the file up first, and
// verifies that no other card changed before writing. Card matching is strict:
// ambiguous or empty matches abort instead of guessing.
//
// Usage: node tracker.mjs <command> [args] [--dry]
// (--hidden still works wherever --archived does; archived cards are stored as
// "hidden": true.)
//   list [--column NAME] [--archived] [--all]
//   show <query>
//   columns
//   add-link <query> <url> [--label TEXT] [--first]
//   remove-link <query> <url>
//   link-workspace <query> [workspace-id]     // default: $CONDUCTOR_WORKSPACE_ID
//   unlink-workspace <query> [workspace-id]   // default: $CONDUCTOR_WORKSPACE_ID
//   link-thread <query> [thread-id]           // default: the T3 Code thread in this directory
//   unlink-thread <query> <thread-id>
//   needs-you <query> --reason TEXT --action TEXT
//   clear-needs-you <query>
//   set <query> [--title T] [--column C] [--color HEX|none]
//              [--complexity XS|S|M|L|XL|none] [--notes N]
//              [--append-notes N] [--archived true|false]
//   add-card --title T [--column C] [--link URL]... [--color HEX]
//            [--complexity XS|S|M|L|XL] [--notes N] [--archived] [--top]
//   add-column <name> [--after EXISTING]
//   cold-storage --all | [--archived-before WHEN] [--archived-after WHEN] [--include-undated]
//                // move archived cards out of data.json into cold-storage.jsonl
//                // WHEN: an ISO date/time, or an age like 12h, 7d, 2w
//   validate
//   where                      // print the resolved tasks-data/data.json path and why
//   context <query> [--tab TAB]          // print the card's project context (memory)
//   context-init <query> [--type regular|bug|research] [--summary S]
//                [--status S] [--owner O] [--next N]
//   context-set <query> [--type T] [--summary S] [--status S] [--owner O] [--next N]
//   context-write <query> <tab> [--append] [--label L] [--file PATH]   // content on stdin
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
// Env: CORVID_DIR overrides the project directory (the file is still
// tasks-data/data.json under it); --data PATH overrides the full data.json path.
// Either override still has to pass the location checks unless
// --allow-nonstandard is also passed.

import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  openSync,
  readSync,
  closeSync,
  statSync,
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
import { execFileSync, execSync } from 'node:child_process';
import {
  TYPES,
  TABS,
  TYPE_LABELS,
  contextRoot,
  readContext,
  initContext,
  setProject,
  writeTab,
} from './context.mjs';

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
// A flag under its new name or its old one (e.g. --archived or --hidden). Both
// are read so neither is left in argv.
function flagEither(name, old) {
  const a = flag(name);
  const b = flag(old);
  return a ?? b;
}
function bareFlagEither(name, old) {
  const a = bareFlag(name);
  const b = bareFlag(old);
  return a || b;
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
const BACKUP_DIR = join(homedir(), '.corvid-backups');
const KEEP_BACKUPS = 20;

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// Resolve the data.json path from explicit flag > env > the canonical checkout.
// Never from process.cwd(), so running this from a git worktree or anywhere
// else still edits the one real board.
// The board file lives at <checkout root>/tasks-data/data.json. The root is the
// canonical checkout (or CORVID_DIR); only the child path moved under
// tasks-data/ so it can be synced on its own without node_modules et al.
function resolveDataPath() {
  const explicit = flag('data');
  if (typeof explicit === 'string') {
    const path = resolve(explicit);
    return { path, root: dirname(path), source: '--data' };
  }
  const env = process.env.CORVID_DIR;
  if (env) {
    const root = resolve(env);
    return { path: join(root, 'tasks-data', 'data.json'), root, source: 'CORVID_DIR' };
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
  // --data/CORVID_DIR pointing at any other checkout is a deliberate act and
  // is honoured, since a board can legitimately live in a different clone.
  if (isLinkedWorktree(realDir) && !ALLOW_NONSTANDARD) {
    const hint =
      source === 'canonical'
        ? '  Point CORVID_DIR at the checkout that holds the real board, or pass\n  --allow-nonstandard if you really mean this copy.'
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

function listening(port) {
  try {
    return Boolean(execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null`, { encoding: 'utf8' }).trim());
  } catch {
    return false;
  }
}

function appRunning() {
  return [8787, 5473].find(listening) ?? null;
}

// Set the target card's change timestamps (ISO): updatedAt on any change,
// createdAt for a new card, and archivedAt when it's archived (removed when it's
// unarchived). Mirrors stamp() in src/cards.ts.
function stampCard(beforeData, data, cardId) {
  const prev = beforeData.cards.find((c) => c.id === cardId);
  const card = data.cards.find((c) => c.id === cardId);
  if (!card || (prev && JSON.stringify(prev) === JSON.stringify(card))) return;
  const now = new Date().toISOString();
  if (!prev) card.createdAt ??= now;
  card.updatedAt = now;
  if (card.hidden && !prev?.hidden) card.archivedAt = now;
  if (!card.hidden) delete card.archivedAt;
}

function commit(before, data, cardId, summary) {
  const beforeParsed = JSON.parse(before);
  assertOnlyTouched(beforeParsed, data, cardId);
  stampCard(beforeParsed, data, cardId);
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
      `NOTE: the Corvid app is running (port ${port}). It watches data.json and reloads ` +
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

// Guard for cold-storage: the only change is that archived cards left the
// array. Everything else, and the remaining cards' content and order, is as it was.
function assertOnlyRemoved(beforeData, afterData, removedIds) {
  const rest = (d) => JSON.stringify({ ...d, cards: undefined });
  if (rest(beforeData) !== rest(afterData)) die('refusing to write: the change would affect more than the cards');
  const kept = beforeData.cards.filter((c) => !removedIds.has(c.id));
  if (JSON.stringify(kept) !== JSON.stringify(afterData.cards))
    die('refusing to write: the change would modify or reorder the remaining cards');
  for (const c of beforeData.cards)
    if (removedIds.has(c.id) && !c.hidden) die(`refusing to write: ${short(c.id)} is not archived`);
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
    c.hidden ? '(archived)' : '',
    JSON.stringify(c.title),
    `${c.links.length} link${c.links.length === 1 ? '' : 's'}`,
    c.workspaces?.length ? `${c.workspaces.length} workspace${c.workspaces.length === 1 ? '' : 's'}` : '',
    c.threads?.length ? `${c.threads.length} thread${c.threads.length === 1 ? '' : 's'}` : '',
    c.color ? c.color : '',
    c.complexity ? c.complexity : '',
    c.needsYou ? 'NEEDS YOU' : '',
    c.updatedAt ? `updated ${c.updatedAt.slice(0, 10)}` : '',
    c.archivedAt ? `archived ${c.archivedAt.slice(0, 10)}` : '',
  ].filter(Boolean);
  return `${String(i).padStart(3)}  ${bits.join('  ')}`;
}

// A query matches a card by: exact id, id prefix (>=4 chars), a case-insensitive
// substring of the title, a substring of any of its link URLs, or an exact
// linked workspace or T3 thread id. Exactly one card must match; 0 or 2+ is an error listing
// the candidates.
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
  const byWorkspace = data.cards.filter(
    (c) => (c.workspaces || []).includes(q) || (c.threads || []).includes(q),
  );
  const hits = [...new Set([...idPrefix, ...byTitle, ...byLink, ...byWorkspace])];
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

// Conductor workspace ids are UUIDs. Stored lowercase so matching is exact.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The workspace id from the command line, else the current Conductor workspace.
function workspaceArg() {
  const given = argv.shift();
  const id = given && !given.startsWith('--') ? given : process.env.CONDUCTOR_WORKSPACE_ID;
  if (!id) die('missing workspace id (pass one, or run inside Conductor so $CONDUCTOR_WORKSPACE_ID is set)');
  if (!UUID_RE.test(id)) die(`workspace id must be a UUID, got ${JSON.stringify(id)}`);
  return id.toLowerCase();
}

// T3 Code keeps its threads in a local SQLite file. Override with T3_DB.
const T3_DB =
  process.env.T3_DB || join(process.env.T3CODE_HOME || join(homedir(), '.t3'), 'userdata', 'statev2.sqlite');

// The thread id from the command line (a UUID or a t3code://threads/<env>/<id>
// link), else the one T3 Code thread working in this directory's git worktree.
// T3 doesn't expose the thread id to agents, so this matches on the worktree
// path T3 records for each thread, and refuses to guess when that isn't unique
// (e.g. several threads in the main checkout).
function threadArg({ detect = true } = {}) {
  const given = argv.shift();
  if (given && !given.startsWith('--')) {
    const m = given.match(/^t3code(?:-[a-z]+)?:\/\/threads\/[^/]+\/([^/?#]+)/i);
    const id = m ? m[1] : given;
    if (!UUID_RE.test(id)) die(`thread id must be a UUID or a t3code:// thread link, got ${JSON.stringify(given)}`);
    return id.toLowerCase();
  }
  if (!detect) die('missing thread id');
  if (!existsSync(T3_DB)) die(`missing thread id (T3 Code database not found at ${T3_DB})`);
  let dir = process.cwd();
  try {
    dir = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || dir;
  } catch {
    // Not in a git repo: match on the current directory.
  }
  const sql = `select thread_id as id, title from orchestration_v2_projection_threads
    where json_extract(payload_json, '$.worktreePath') = '${dir.replace(/'/g, "''")}'
      and archived_at is null and deleted_at is null
    order by updated_at desc`;
  let rows;
  try {
    const out = execFileSync('sqlite3', ['-readonly', '-json', '-cmd', '.timeout 2000', T3_DB, sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    rows = out.trim() ? JSON.parse(out) : [];
  } catch (e) {
    die(`couldn't read T3 Code's database to find this thread; pass the thread id (${String(e.message).split('\n')[0]})`);
  }
  if (rows.length === 1) return rows[0].id.toLowerCase();
  if (!rows.length) die(`no T3 Code thread is working in ${dir}; pass the thread id`);
  die(
    `${rows.length} T3 Code threads are working in ${dir}; pass the thread id:\n` +
      rows.map((r) => `  ${r.id}  ${JSON.stringify(r.title)}`).join('\n'),
  );
}

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

// --- cold storage ---

// Archived cards moved off the board, one JSON object per line:
// {"movedAt": ISO, "card": Card}. Only ever appended to, never rewritten.
const COLD_PATH = join(dirname(DATA_PATH), 'cold-storage.jsonl');

// An ISO date/time, or an age ago from now: 12h, 7d, 2w.
function parseWhen(value, name) {
  if (typeof value !== 'string') die(`--${name} needs a value: an ISO date like 2026-10-12, or an age like 7d or 2w`);
  const m = /^(\d+)([hdw])$/i.exec(value);
  if (m) return Date.now() - Number(m[1]) * { h: 3600e3, d: 86400e3, w: 604800e3 }[m[2].toLowerCase()];
  const t = Date.parse(value);
  if (Number.isNaN(t)) die(`--${name} must be an ISO date like 2026-10-12, or an age like 7d or 2w, got ${JSON.stringify(value)}`);
  return t;
}

// Append lines to the cold storage file, starting on a fresh line even if the
// file was hand-edited and lost its trailing newline.
function appendCold(lines) {
  let lead = '';
  if (existsSync(COLD_PATH) && statSync(COLD_PATH).size > 0) {
    const fd = openSync(COLD_PATH, 'r');
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, statSync(COLD_PATH).size - 1);
    closeSync(fd);
    if (last.toString() !== '\n') lead = '\n';
  }
  appendFileSync(COLD_PATH, lead + lines.join('\n') + '\n');
}

// --- project context (see context.mjs) ---

const CONTEXT_ROOT = contextRoot(DATA_PATH);

// The context page in the running app: the Vite dev server if it's up (in dev,
// :8787 serves only the API), else the built app on :8787.
function contextUrl(cardId) {
  const port = listening(5473) || !listening(8787) ? 5473 : 8787;
  return `http://localhost:${port}/#/context/${cardId}`;
}

// Header fields for context-init / context-set.
function contextFields() {
  const out = {};
  for (const k of ['type', 'summary', 'status', 'owner', 'next']) {
    const v = flag(k);
    if (typeof v === 'string') out[k] = v;
  }
  if (out.type !== undefined && !TYPES.includes(out.type)) die(`--type must be one of ${TYPES.join(' | ')}`);
  return out;
}

// Tab content from --file, else stdin (a heredoc).
function contentArg() {
  const file = flag('file');
  if (typeof file === 'string') {
    try {
      return readFileSync(resolve(file), 'utf8');
    } catch (e) {
      die(`cannot read ${file}: ${e.message}`);
    }
  }
  let text = '';
  if (!process.stdin.isTTY) {
    try {
      text = readFileSync(0, 'utf8');
    } catch {}
  }
  if (!text.trim()) die('no content: pass the tab content on stdin (a heredoc) or with --file PATH');
  return text;
}

function printContext(card, ctx, onlyTab) {
  const p = ctx.project;
  console.log(`# context: ${ctx.dir}`);
  console.log(`# page: ${contextUrl(card.id)}`);
  console.log(`card: ${short(card.id)} ${JSON.stringify(card.title)}`);
  console.log(`type: ${p.type} (${TYPE_LABELS[p.type] ?? p.type})   updated: ${p.updated || 'unknown'}`);
  for (const k of ['summary', 'status', 'owner', 'next']) console.log(`${k}: ${p[k] || '(not set)'}`);
  const tabs = onlyTab ? ctx.tabs.filter((t) => t.id === onlyTab) : ctx.tabs;
  if (onlyTab && !tabs.length) die(`no tab ${JSON.stringify(onlyTab)}. Tabs: ${ctx.tabs.map((t) => t.id).join(', ')}`);
  for (const t of tabs) {
    const q = t.question ? ` (${t.question})` : '';
    console.log(`\n===== ${t.label}: ${t.file}${q}${t.empty ? ' [empty]' : ''} =====`);
    console.log(t.content.replace(/\n+$/, ''));
  }
}

switch (cmd) {
  case 'context': {
    printTarget();
    const card = findCard(load(), argv.shift());
    const ctx = readContext(CONTEXT_ROOT, card.id);
    if (!ctx) {
      console.log(`card ${short(card.id)} ${JSON.stringify(card.title)} has no context yet.`);
      console.log(`create it with: context-init ${card.id} --type ${TYPES.join('|')}`);
      break;
    }
    const tab = flag('tab');
    printContext(card, ctx, typeof tab === 'string' ? tab : undefined);
    break;
  }
  case 'context-init': {
    printTarget();
    const card = findCard(load(), argv.shift());
    const fields = contextFields();
    if (readContext(CONTEXT_ROOT, card.id)) die(`card ${short(card.id)} already has context; read it with \`context ${card.id}\``);
    if (DRY) {
      console.log('--- DRY RUN, nothing written ---');
      console.log(`would create ${fields.type ?? 'regular'} context for ${short(card.id)} in ${join(CONTEXT_ROOT, card.id)}`);
      break;
    }
    const dir = initContext(CONTEXT_ROOT, card.id, fields);
    const ctx = readContext(CONTEXT_ROOT, card.id);
    console.log(`created ${ctx.project.type} context for ${short(card.id)} ${JSON.stringify(card.title)}`);
    console.log(`  ${dir}`);
    console.log(`  tabs: ${ctx.tabs.map((t) => t.id).join(', ')}`);
    console.log(`  page: ${contextUrl(card.id)}`);
    break;
  }
  case 'context-set': {
    printTarget();
    const card = findCard(load(), argv.shift());
    const fields = contextFields();
    if (!Object.keys(fields).length) die('context-set needs at least one of --type --summary --status --owner --next');
    if (!readContext(CONTEXT_ROOT, card.id)) die(`card ${short(card.id)} has no context; run context-init first`);
    if (DRY) {
      console.log('--- DRY RUN, nothing written ---');
      console.log(JSON.stringify(fields, null, 2));
      break;
    }
    const { changes } = setProject(CONTEXT_ROOT, card.id, fields, { backupDir: BACKUP_DIR });
    if (!changes.length) console.log('no change (context already matches)');
    else console.log(`updated context of ${short(card.id)} ${JSON.stringify(card.title)}:\n  ${changes.join('\n  ')}`);
    break;
  }
  case 'context-write': {
    printTarget();
    const card = findCard(load(), argv.shift());
    const tab = argv.shift();
    if (!tab || tab.startsWith('--')) die(`missing tab. Tabs: ${Object.keys(TABS).join(', ')}, or a new name for an extra tab`);
    const append = bareFlag('append');
    const label = flag('label');
    const content = contentArg();
    if (!readContext(CONTEXT_ROOT, card.id)) die(`card ${short(card.id)} has no context; run context-init first`);
    if (DRY) {
      console.log('--- DRY RUN, nothing written ---');
      console.log(`would ${append ? 'append' : 'write'} ${content.length} chars to ${tab}`);
      break;
    }
    let res;
    try {
      res = writeTab(CONTEXT_ROOT, card.id, tab, content, {
        append,
        label: typeof label === 'string' ? label : undefined,
        backupDir: BACKUP_DIR,
      });
    } catch (e) {
      die(e.message);
    }
    if (!res.changed) console.log(`no change (${res.id}.md already matches)`);
    else console.log(`${append ? 'appended to' : 'wrote'} ${res.path}${res.backup ? `\nbackup ${res.backup}` : ''}`);
    break;
  }
  case 'where': {
    printTarget();
    console.log(`repo root (from this script's location): ${CANONICAL_DIR}`);
    console.log(`CORVID_DIR: ${process.env.CORVID_DIR ?? '(unset)'}`);
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
    const onlyArchived = bareFlagEither('archived', 'hidden');
    const all = bareFlag('all');
    let cards = data.cards;
    if (column) {
      requireColumn(data, column);
      cards = cards.filter((c) => c.column === column);
    }
    // Archived cards in the board's Archived column order: most recently
    // archived first, then ones with no archivedAt in board order.
    if (onlyArchived)
      cards = cards
        .filter((c) => c.hidden)
        .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
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
      console.log(`${col}  —  ${n} visible${h ? `, ${h} archived` : ''}`);
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
    for (const w of card.workspaces || []) console.log(`  workspace: ${w}`);
    for (const t of card.threads || []) console.log(`  t3 thread: ${t}`);
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
  case 'link-workspace': {
    printTarget();
    const before = readFileSync(DATA_PATH, 'utf8');
    const data = load();
    const card = findCard(data, argv.shift());
    const id = workspaceArg();
    if ((card.workspaces || []).includes(id)) {
      console.log(`card ${short(card.id)} already has workspace ${id}`);
      break;
    }
    card.workspaces = [...(card.workspaces || []), id];
    commit(before, data, card.id, `linked workspace to ${short(card.id)} ${JSON.stringify(card.title)}:\n  ${id}`);
    break;
  }
  case 'unlink-workspace': {
    printTarget();
    const before = readFileSync(DATA_PATH, 'utf8');
    const data = load();
    const card = findCard(data, argv.shift());
    const id = workspaceArg();
    if (!(card.workspaces || []).includes(id)) die(`card ${short(card.id)} has no workspace ${id}`);
    card.workspaces = card.workspaces.filter((w) => w !== id);
    if (!card.workspaces.length) delete card.workspaces;
    commit(before, data, card.id, `unlinked workspace from ${short(card.id)}:\n  ${id}`);
    break;
  }
  case 'link-thread': {
    printTarget();
    const before = readFileSync(DATA_PATH, 'utf8');
    const data = load();
    const card = findCard(data, argv.shift());
    const id = threadArg();
    if ((card.threads || []).includes(id)) {
      console.log(`card ${short(card.id)} already has thread ${id}`);
      break;
    }
    card.threads = [...(card.threads || []), id];
    commit(before, data, card.id, `linked T3 thread to ${short(card.id)} ${JSON.stringify(card.title)}:\n  ${id}`);
    break;
  }
  case 'unlink-thread': {
    printTarget();
    const before = readFileSync(DATA_PATH, 'utf8');
    const data = load();
    const card = findCard(data, argv.shift());
    const id = threadArg({ detect: false });
    if (!(card.threads || []).includes(id)) die(`card ${short(card.id)} has no thread ${id}`);
    card.threads = card.threads.filter((t) => t !== id);
    if (!card.threads.length) delete card.threads;
    commit(before, data, card.id, `unlinked T3 thread from ${short(card.id)}:\n  ${id}`);
    break;
  }
  // Flag a card as waiting on the user, with why the agent stopped and what to
  // do next. Replaces any existing flag (and its timestamp).
  case 'needs-you': {
    printTarget();
    const before = readFileSync(DATA_PATH, 'utf8');
    const data = load();
    const card = findCard(data, argv.shift());
    const reason = flag('reason');
    const action = flag('action');
    if (typeof reason !== 'string' || !reason.trim()) die('needs-you requires --reason TEXT');
    if (typeof action !== 'string' || !action.trim()) die('needs-you requires --action TEXT');
    card.needsYou = { reason: reason.trim(), action: action.trim(), since: new Date().toISOString() };
    commit(
      before,
      data,
      card.id,
      `flagged ${short(card.id)} ${JSON.stringify(card.title)} as needing you:\n  reason: ${card.needsYou.reason}\n  action: ${card.needsYou.action}`,
    );
    break;
  }
  case 'clear-needs-you': {
    printTarget();
    const before = readFileSync(DATA_PATH, 'utf8');
    const data = load();
    const card = findCard(data, argv.shift());
    if (!card.needsYou) {
      console.log(`card ${short(card.id)} has no needs-you flag`);
      break;
    }
    delete card.needsYou;
    commit(before, data, card.id, `cleared needs-you on ${short(card.id)} ${JSON.stringify(card.title)}`);
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
    const hidden = flagEither('archived', 'hidden');
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
        die('--archived takes true or false');
      changes.push(`archived: ${card.hidden} -> ${v}`);
      card.hidden = v;
    }
    if (!changes.length) die('set needs at least one of --title --column --color --complexity --notes --append-notes --archived');
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
    const hidden = bareFlagEither('archived', 'hidden');
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
  // Move archived cards off the board into cold-storage.jsonl. Appends to the
  // cold storage file first, then removes the cards from data.json, so a failed
  // write can duplicate a card in cold storage but never lose one.
  case 'cold-storage': {
    printTarget();
    const before = readFileSync(DATA_PATH, 'utf8');
    const data = load();
    const all = bareFlag('all');
    const beforeArg = flag('archived-before');
    const afterArg = flag('archived-after');
    const includeUndated = bareFlag('include-undated');
    if (!all && beforeArg === undefined && afterArg === undefined)
      die('cold-storage needs --all, --archived-before WHEN, or --archived-after WHEN');
    if (all && (beforeArg !== undefined || afterArg !== undefined))
      die('--all moves every archived card; drop it to filter by date');
    if (includeUndated && beforeArg === undefined)
      die('--include-undated only applies with --archived-before');
    const beforeT = beforeArg === undefined ? undefined : parseWhen(beforeArg, 'archived-before');
    const afterT = afterArg === undefined ? undefined : parseWhen(afterArg, 'archived-after');

    const archived = data.cards.filter((c) => c.hidden);
    const undated = archived.filter((c) => !c.archivedAt);
    const picked = archived.filter((c) => {
      if (all) return true;
      // No archivedAt: archived before the timestamps existed, so older than
      // any dated card but of unknown age.
      if (!c.archivedAt) return includeUndated;
      const t = Date.parse(c.archivedAt);
      return (beforeT === undefined || t < beforeT) && (afterT === undefined || t > afterT);
    });
    const range = all
      ? 'all archived cards'
      : [
          beforeT !== undefined && `archived before ${new Date(beforeT).toISOString()}`,
          afterT !== undefined && `archived after ${new Date(afterT).toISOString()}`,
        ]
          .filter(Boolean)
          .join(' and ');
    const skippedUndated = !all && !includeUndated ? undated.length : 0;
    const note = skippedUndated
      ? `\n${skippedUndated} archived card(s) have no archivedAt (archived before timestamps existed) and were left on the board.` +
        (beforeT !== undefined ? ' Add --include-undated to move them too.' : '')
      : '';
    if (!picked.length) {
      console.log(`no archived cards match (${range}). ${archived.length} archived in total.${note}`);
      break;
    }

    const removed = new Set(picked.map((c) => c.id));
    const next = { ...data, cards: data.cards.filter((c) => !removed.has(c.id)) };
    assertOnlyRemoved(JSON.parse(before), next, removed);
    const list = picked
      .map((c) => `  ${short(c.id)}  ${c.archivedAt ? c.archivedAt.slice(0, 10) : 'undated   '}  ${JSON.stringify(c.title)}`)
      .join('\n');
    const summary = `${DRY ? 'would move' : 'moved'} ${picked.length} of ${archived.length} archived card(s) (${range}) to ${COLD_PATH}:\n${list}${note}`;
    if (DRY) {
      console.log('--- DRY RUN, nothing written ---');
      console.log(summary);
      break;
    }
    const movedAt = new Date().toISOString();
    appendCold(picked.map((card) => JSON.stringify({ movedAt, card })));
    writeAndReport(serialize(next), summary);
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
      if (c.workspaces !== undefined) {
        if (!Array.isArray(c.workspaces)) problems.push(`${where}: workspaces is not an array`);
        else {
          for (const w of c.workspaces)
            if (typeof w !== 'string' || !UUID_RE.test(w)) problems.push(`${where}: bad workspace id ${JSON.stringify(w)}`);
          if (new Set(c.workspaces).size !== c.workspaces.length) problems.push(`${where}: duplicate workspace id`);
        }
      }
      if (c.threads !== undefined) {
        if (!Array.isArray(c.threads)) problems.push(`${where}: threads is not an array`);
        else {
          for (const t of c.threads)
            if (typeof t !== 'string' || !UUID_RE.test(t)) problems.push(`${where}: bad thread id ${JSON.stringify(t)}`);
          if (new Set(c.threads).size !== c.threads.length) problems.push(`${where}: duplicate thread id`);
        }
      }
      for (const key of ['createdAt', 'updatedAt', 'archivedAt'])
        if (c[key] !== undefined && (typeof c[key] !== 'string' || Number.isNaN(Date.parse(c[key]))))
          problems.push(`${where}: ${key} is not an ISO timestamp`);
      if (c.archivedAt !== undefined && !c.hidden) problems.push(`${where}: archivedAt set on a card that isn't archived`);
      if (c.hiddenAt !== undefined)
        problems.push(`${where}: hiddenAt is the old name for archivedAt; run node scripts/rename-hidden-at.mjs`);
      if (c.needsYou !== undefined) {
        const n = c.needsYou;
        if (typeof n?.reason !== 'string' || typeof n?.action !== 'string' || typeof n?.since !== 'string')
          problems.push(`${where}: needsYou must be {reason, action, since}`);
      }
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
    console.error(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 37).join('\n').replace(/^\/\/ ?/gm, ''));
    process.exit(cmd ? 1 : 0);
}
