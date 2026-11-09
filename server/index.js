import express from 'express';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  contextRoot,
  contextSignatures,
  initContext,
  listContexts,
  readContext,
  setProject,
  validCardId,
  writeTab,
} from '../.claude/skills/corvid/scripts/context.mjs';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'tasks-data');
const DATA_PATH = join(DATA_DIR, 'data.json');
// Each card's project context (memory) lives in tasks-data/context/<card id>/.
// The corvid skill's tracker writes the same files, and backs them up to the
// same place.
const CONTEXT_ROOT = contextRoot(DATA_PATH);
const BACKUP_DIR = join(homedir(), '.corvid-backups');

// --- minimal .env.local loader (no dependency) ---
function loadEnv() {
  const p = join(ROOT, '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}
loadEnv();

const PORT = process.env.PORT || 8787;
// Bind to loopback only. The server holds your gh/Vercel/Linear credentials and
// has no auth of its own, so it must not be reachable from the local network.
// Override deliberately (e.g. HOST=0.0.0.0) only if you understand that.
const HOST = process.env.HOST || '127.0.0.1';

const DEFAULT_DATA = {
  columns: [
    'Todo',
    'In Progress',
    'In Review',
    'Addressing Feedback',
    'Top Priority Now',
    'Done',
    // Agent-managed suggestions. Any column whose name contains "claude" is
    // lifted out of the board into its own toolbar popover, so this one stays
    // out of the way until something fills it (see docs/suggested-tasks-routine.md).
    // Kept last on purpose: quick-add and the tracker script's add-card both
    // fall back to columns[0], which should stay a real working column.
    'Suggested by Claude',
  ],
  cards: [],
};

// ---------------- storage ----------------
async function readData() {
  if (!existsSync(DATA_PATH)) return structuredClone(DEFAULT_DATA);
  try {
    return JSON.parse(await readFile(DATA_PATH, 'utf8'));
  } catch {
    return structuredClone(DEFAULT_DATA);
  }
}
function hashData(str) {
  return createHash('sha1').update(str).digest('hex');
}

// Hash of the last data.json content this server is aware of. Updated both when
// we write (so our own writes don't look like external edits) and when the
// watcher observes an external change. Lets us tell "the UI saved" apart from
// "a skill/editor changed the file" so we only notify the browser for the latter.
let lastKnownHash = existsSync(DATA_PATH)
  ? hashData(readFileSync(DATA_PATH, 'utf8'))
  : null;

async function writeData(data) {
  const str = JSON.stringify(data, null, 2);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_PATH, str);
  lastKnownHash = hashData(str);
}

// ---------------- GitHub ----------------
function parsePrUrl(url) {
  const m = String(url).match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

const PR_QUERY = `
query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      title number state isDraft merged url
      reviewDecision
      reviewThreads(first:100){ totalCount nodes { isResolved } }
      commits(last:1){ nodes { commit { statusCheckRollup { state } } } }
    }
  }
}`;

// Shape a PullRequest GraphQL node into a PrStatus. Used by both the
// single-PR fetch and the "my open PRs" search.
function shapePr(pr) {
  const threads = pr.reviewThreads?.nodes || [];
  const unresolved = threads.filter((t) => !t.isResolved).length;
  const ci = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state || null;
  return {
    url: pr.url,
    title: pr.title,
    number: pr.number,
    state: pr.merged ? 'MERGED' : pr.state, // OPEN | CLOSED | MERGED
    isDraft: pr.isDraft,
    reviewDecision: pr.reviewDecision, // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null
    unresolvedThreads: unresolved,
    totalThreads: pr.reviewThreads?.totalCount ?? threads.length,
    ci, // SUCCESS | FAILURE | PENDING | ERROR | EXPECTED | null
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchPr(url) {
  const ref = parsePrUrl(url);
  if (!ref) return { url, error: 'Unrecognized PR URL' };
  try {
    const { stdout } = await execFileP(
      'gh',
      [
        'api',
        'graphql',
        '-f',
        `query=${PR_QUERY}`,
        '-F',
        `owner=${ref.owner}`,
        '-F',
        `repo=${ref.repo}`,
        '-F',
        `number=${ref.number}`,
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const pr = JSON.parse(stdout)?.data?.repository?.pullRequest;
    if (!pr) return { url, error: 'PR not found' };
    return shapePr(pr);
  } catch (e) {
    return { url, error: cleanErr(e) };
  }
}

// All open PRs authored by the authenticated gh user, across every repo.
const MY_PRS_QUERY = `
query($q:String!){
  search(query:$q, type:ISSUE, first:100){
    nodes{
      ... on PullRequest {
        title number url isDraft state merged
        reviewDecision
        repository{ isArchived }
        reviewThreads(first:100){ totalCount nodes { isResolved } }
        commits(last:1){ nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

async function fetchMyPrs() {
  try {
    const { stdout } = await execFileP(
      'gh',
      [
        'api',
        'graphql',
        '-f',
        `query=${MY_PRS_QUERY}`,
        '-F',
        'q=is:pr is:open author:@me archived:false',
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const nodes = JSON.parse(stdout)?.data?.search?.nodes || [];
    // The search's archived:false qualifier isn't reliable (GitHub's index can
    // lag behind a repo being archived), so also drop archived repos here.
    return {
      prs: nodes
        .filter((n) => n && n.url && !n.repository?.isArchived)
        .map(shapePr),
    };
  } catch (e) {
    return { prs: [], githubError: cleanErr(e) };
  }
}

// ---------------- Linear ----------------
function parseLinearUrl(url) {
  const s = String(url);
  const issue = s.match(/linear\.app\/[^/]+\/issue\/([A-Za-z0-9]+)-(\d+)/);
  if (issue)
    return {
      kind: 'issue',
      team: issue[1].toUpperCase(),
      number: Number(issue[2]),
    };
  // Project URL: .../project/{name-slug}-{slugId}[/...]. slugId is the trailing hex token.
  const project = s.match(
    /linear\.app\/[^/]+\/project\/[^/]*?-([0-9a-f]{8,})(?:\/|$)/,
  );
  if (project) return { kind: 'project', slugId: project[1] };
  return null;
}

const ISSUE_QUERY = `
query($team:String!,$number:Float!){
  issues(filter:{team:{key:{eq:$team}},number:{eq:$number}}, first:1){
    nodes{
      identifier title url state{ name color type }
      attachments(first:25){ nodes{ url title } }
    }
  }
}`;

const PROJECT_QUERY = `
query($id:String!){
  project(id:$id){
    name url status{ name color type }
    externalLinks(first:25){ nodes{ url label } }
  }
}`;

async function linearGraphql(query, variables) {
  const key = process.env.LINEAR_API_KEY;
  if (!key) throw new Error('LINEAR_API_KEY not set in .env.local');
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || 'Linear error');
  return json.data;
}

// Classify an external resource link by host so the UI can badge Figma designs
// and Notion specs specially. Everything else is a generic link.
function resourceType(url) {
  const s = String(url);
  if (/figma\.com/i.test(s)) return 'figma';
  if (/notion\.(so|site|com)/i.test(s)) return 'notion';
  return 'link';
}

// Shape a Linear issue's attachments / project's external links into
// LinearResources. Shows every link (Notion specs, Figma designs, docs, Slack,
// etc.) but drops GitHub links, whose PRs already render as their own cards.
function shapeResources(nodes) {
  return (nodes || [])
    .map((n) => ({
      url: n.url,
      title: n.title || n.label || '',
      type: resourceType(n.url),
    }))
    .filter((r) => r.url && !/github\.com/i.test(r.url));
}

// Shape a Linear issue / project node into an IssueStatus.
function shapeLinearIssue(issue) {
  return {
    url: issue.url,
    identifier: issue.identifier,
    title: issue.title,
    stateName: issue.state?.name,
    stateColor: issue.state?.color,
    stateType: issue.state?.type, // backlog|unstarted|started|completed|canceled
    resources: shapeResources(issue.attachments?.nodes),
    fetchedAt: new Date().toISOString(),
  };
}

function shapeLinearProject(p) {
  return {
    url: p.url,
    identifier: 'Project',
    title: p.name,
    stateName: p.status?.name,
    stateColor: p.status?.color,
    stateType: p.status?.type,
    resources: shapeResources(p.externalLinks?.nodes),
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchLinear(url) {
  const ref = parseLinearUrl(url);
  if (!ref)
    return {
      url,
      error: 'Unrecognized Linear URL (expected an issue or project link)',
    };
  try {
    if (ref.kind === 'project') {
      const p = (await linearGraphql(PROJECT_QUERY, { id: ref.slugId }))
        ?.project;
      if (!p) return { url, error: 'Project not found' };
      return shapeLinearProject(p);
    }
    const issue = (
      await linearGraphql(ISSUE_QUERY, { team: ref.team, number: ref.number })
    )?.issues?.nodes?.[0];
    if (!issue) return { url, error: 'Issue not found' };
    return shapeLinearIssue(issue);
  } catch (e) {
    return { url, error: cleanErr(e) };
  }
}

// Issues assigned to me (excluding done/cancelled) and projects I lead. Issues
// and projects are fetched separately so one failing doesn't wipe out the other.
const MY_ISSUES_QUERY = `
query {
  viewer {
    assignedIssues(first:100, filter:{ state:{ type:{ nin:["completed","canceled"] } } }){
      nodes{ identifier title url state{ name color type } }
    }
  }
}`;

const MY_PROJECTS_QUERY = `
query {
  projects(first:100, filter:{ lead:{ isMe:{ eq:true } } }){
    nodes{ name url status{ name color type } }
  }
}`;

async function fetchMyLinear() {
  if (!process.env.LINEAR_API_KEY) {
    return {
      issues: [],
      projects: [],
      linearError: 'LINEAR_API_KEY not set in .env.local',
    };
  }
  const out = { issues: [], projects: [] };
  try {
    const data = await linearGraphql(MY_ISSUES_QUERY, {});
    out.issues = (data?.viewer?.assignedIssues?.nodes || []).map(
      shapeLinearIssue,
    );
  } catch (e) {
    out.linearError = cleanErr(e);
  }
  try {
    const data = await linearGraphql(MY_PROJECTS_QUERY, {});
    out.projects = (data?.projects?.nodes || [])
      .filter((p) => !['completed', 'canceled'].includes(p.status?.type))
      .map(shapeLinearProject);
  } catch (e) {
    out.linearError = out.linearError || cleanErr(e);
  }
  return out;
}

function cleanErr(e) {
  const msg = (e?.stderr || e?.message || String(e)).trim();
  return msg.split('\n').slice(0, 2).join(' ').slice(0, 300);
}

// ---------------- Vercel ----------------
// Auth mirrors how we lean on the gh CLI: instead of a token in .env, we reuse
// the token the Vercel CLI already stored at login (`vercel login`). A
// VERCEL_TOKEN env var still wins if set.
const VERCEL_API = 'https://api.vercel.com';
let vercelTokenCache;

function vercelAuthPaths() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const paths = [];
  if (process.platform === 'darwin') {
    paths.push(join(home, 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'));
  }
  if (process.env.XDG_DATA_HOME) {
    paths.push(join(process.env.XDG_DATA_HOME, 'com.vercel.cli', 'auth.json'));
  }
  paths.push(join(home, '.local', 'share', 'com.vercel.cli', 'auth.json'));
  if (process.env.APPDATA) {
    paths.push(join(process.env.APPDATA, 'com.vercel.cli', 'auth.json'));
  }
  return paths;
}

function vercelToken() {
  if (vercelTokenCache !== undefined) return vercelTokenCache;
  if (process.env.VERCEL_TOKEN) return (vercelTokenCache = process.env.VERCEL_TOKEN);
  for (const p of vercelAuthPaths()) {
    if (!existsSync(p)) continue;
    try {
      const tok = JSON.parse(readFileSync(p, 'utf8'))?.token;
      if (tok) return (vercelTokenCache = tok);
    } catch {
      // try next candidate
    }
  }
  return (vercelTokenCache = null);
}

async function vercelFetch(path) {
  const token = vercelToken();
  if (!token) {
    throw new Error('Vercel auth not found. Run `vercel login` or set VERCEL_TOKEN.');
  }
  const res = await fetch(`${VERCEL_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Vercel API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

function teamQuery(teamId) {
  return teamId ? `&teamId=${encodeURIComponent(teamId)}` : '';
}

// Every project the token can see: the personal account plus each team. Each
// project is tagged with its teamId so deployment lookups hit the right scope,
// and with its dashboard URL (vercel.com/<team or username>/<project>).
async function listVercelProjects() {
  const scopes = [undefined];
  let username;
  try {
    username = (await vercelFetch('/v2/user'))?.user?.username;
  } catch {
    // Without it, personal projects just get no dashboard link.
  }
  try {
    const teams = (await vercelFetch('/v2/teams'))?.teams || [];
    for (const t of teams) scopes.push({ id: t.id, slug: t.slug });
  } catch {
    // No team access; personal scope still works.
  }
  const seen = new Set();
  const projects = [];
  for (const scope of scopes) {
    const teamId = scope?.id;
    const data = await vercelFetch(`/v9/projects?limit=100${teamQuery(teamId)}`);
    for (const p of data.projects || []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const slug = scope?.slug ?? username;
      projects.push({
        id: p.id,
        name: p.name,
        teamId,
        teamSlug: scope?.slug,
        url: slug ? `https://vercel.com/${slug}/${encodeURIComponent(p.name)}` : undefined,
      });
    }
  }
  projects.sort((a, b) => a.name.localeCompare(b.name));
  return projects;
}

function shapeDeployment(d) {
  const m = d.meta || {};
  return {
    uid: d.uid,
    name: d.name,
    url: d.url,
    state: d.state,
    readyState: d.readyState || d.state,
    target: d.target ?? null,
    branch: m.githubCommitRef,
    org: m.githubOrg || m.githubCommitOrg,
    repo: m.githubRepo || m.githubCommitRepo,
    prNumber: m.githubPrId ? Number(m.githubPrId) : undefined,
    creator: d.creator?.username,
    createdAt: d.createdAt,
    inspectorUrl: d.inspectorUrl,
  };
}

async function listVercelDeployments(projectId, teamId, limit = 5) {
  const data = await vercelFetch(
    `/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${limit}${teamQuery(teamId)}`,
  );
  return (data.deployments || []).map(shapeDeployment);
}

// ---------------- T3 Code (thread titles and activity) ----------------
// T3 Code keeps its threads in a local SQLite file too. We read the title,
// archived state, and whether a run is in progress for each thread linked on a
// card, plus the environment id its t3code:// deep links need. We read it
// read-only, via the sqlite3 CLI that ships with macOS. The schema is internal
// to T3, so a failure only means no thread info, never a board error.
const T3_HOME = process.env.T3CODE_HOME || join(homedir(), '.t3');
const T3_DB = process.env.T3_DB || join(T3_HOME, 'userdata', 'statev2.sqlite');
const T3_ENV_FILE = join(T3_HOME, 'userdata', 'environment-id');
// The t3 CLI, which starts threads on the running T3 server. Falls back to `t3`
// on PATH when T3's own launcher isn't there.
const T3_BIN = process.env.T3_BIN || (existsSync(join(T3_HOME, 'bin', 't3')) ? join(T3_HOME, 'bin', 't3') : 't3');
// Run states T3 treats as unfinished. "waiting" is a run paused on the user.
const T3_WORKING = ['queued', 'preparing', 'starting', 'running'];
// T3 thread ids: a bare UUID, or a prefixed id such as "mcp:<uuid>" for threads
// started by the CLI or an agent. Ids are interpolated into SQL, so only these
// characters (no quotes) get through.
const T3_THREAD_RE = /^[A-Za-z0-9:%._-]{1,512}$/;

async function readT3EnvironmentId() {
  try {
    return (await readFile(T3_ENV_FILE, 'utf8')).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function queryT3(sql) {
  const { stdout } = await execFileP(
    'sqlite3',
    ['-readonly', '-json', '-cmd', '.timeout 2000', T3_DB, sql],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout.trim() ? JSON.parse(stdout) : [];
}

// Projects in T3 Code, for a card's "Start in T3" project picker.
async function fetchT3Projects() {
  if (!existsSync(T3_DB)) return { projects: [], error: `T3 Code database not found at ${T3_DB}` };
  try {
    const rows = await queryT3(`
      select project_id as id, title as name, workspace_root as path from projection_projects
      where deleted_at is null and archived_at is null
      order by pinned_at is null, lower(title)`);
    return { projects: rows };
  } catch (e) {
    return { projects: [], error: cleanErr(e) };
  }
}

// What a new worktree for a project starts from: the remote's default branch
// (e.g. "origin/main"), fetched first so it's current, else the checked-out
// branch. Null when the project isn't a git repo, so the thread runs in the
// project folder instead.
async function worktreeBase(root) {
  const git = (...args) =>
    execFileP('git', ['-C', root, ...args], { timeout: 20000 }).then((r) => r.stdout.trim());
  try {
    const remoteHead = await git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
    const branch = remoteHead.replace(/^origin\//, '');
    await git('fetch', '--quiet', 'origin', branch).catch(() => {});
    return remoteHead;
  } catch {
    // No origin/HEAD: fall back to the checked-out branch.
  }
  try {
    const head = await git('rev-parse', '--abbrev-ref', 'HEAD');
    return head && head !== 'HEAD' ? head : null;
  } catch {
    return null;
  }
}

// Run a command with `input` on stdin; resolves with stdout, rejects with an
// error carrying stderr.
function runWithInput(cmd, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      const err = new Error(signal ? `${cmd} timed out` : `${cmd} exited with code ${code}`);
      err.stderr = stderr || stdout;
      reject(err);
    });
    child.stdin.end(input);
  });
}

// Start a T3 Code thread in `projectId` with `prompt` as its first message, in
// a new worktree when `worktree` is set. Returns its id and deep link.
async function startT3Thread({ projectId, prompt, title, worktree }) {
  const { projects, error } = await fetchT3Projects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) throw new Error(error || 'Unknown T3 Code project');
  const args = ['thread', 'start', project.id, '-', '--json'];
  if (title) args.push('--title', title.slice(0, 200));
  if (worktree) {
    const base = await worktreeBase(project.path);
    if (base) args.push('--worktree', base);
  }
  const out = await runWithInput(T3_BIN, args, prompt, 60000);
  let threadId;
  try {
    threadId = JSON.parse(out).threadId;
  } catch {
    // Handled below.
  }
  if (typeof threadId !== 'string' || !T3_THREAD_RE.test(threadId)) {
    throw new Error(`Unexpected output from t3 thread start: ${out.trim().slice(0, 200)}`);
  }
  const environmentId = await readT3EnvironmentId();
  const link = environmentId
    ? `t3code://threads/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`
    : undefined;
  return { threadId, environmentId, link };
}

async function fetchThreads(ids) {
  const wanted = [...new Set(ids)].filter((id) => T3_THREAD_RE.test(id));
  if (!wanted.length || !existsSync(T3_DB)) return {};
  // Without an environment id, titles show without a deep link.
  const environmentId = await readT3EnvironmentId();
  const list = wanted.map((id) => `'${id}'`).join(',');
  const working = T3_WORKING.map((s) => `'${s}'`).join(',');
  const sql = `
    select t.thread_id as id, t.title as title, t.archived_at as archived,
      max(case when r.status in (${working}) then 2 when r.status = 'waiting' then 1 else 0 end) as active
    from orchestration_v2_projection_threads t
    left join orchestration_v2_projection_runs r on r.thread_id = t.thread_id
    where t.thread_id in (${list}) and t.deleted_at is null
    group by t.thread_id`;
  try {
    const rows = await queryT3(sql);
    const out = {};
    for (const r of rows) {
      out[r.id] = {
        title: r.title || undefined,
        environmentId,
        archived: !!r.archived,
        activity: r.active === 2 ? 'working' : r.active === 1 ? 'waiting' : 'idle',
      };
    }
    return out;
  } catch {
    return {};
  }
}

// T3 thread ids linked on any card, read from disk so a link added by the UI
// or a skill is picked up on the next poll.
async function linkedThreadIds() {
  const data = await readData();
  return (data.cards || []).flatMap((c) => (Array.isArray(c.threads) ? c.threads : []));
}

// ---------------- app ----------------
const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/api/data', async (_req, res) => {
  res.json(await readData());
});

app.put('/api/data', async (req, res) => {
  await writeData(req.body);
  res.json({ ok: true });
});

// Server-sent events stream. The browser subscribes and reloads data.json when
// it changes on disk from outside the UI (e.g. a skill editing the file). It
// also carries `agents` events with the T3 Code status of linked threads.
const sseClients = new Set();
function broadcastDataChanged() {
  for (const res of sseClients) res.write('event: data\ndata: {}\n\n');
}

// Last agents payload sent, so a new subscriber gets it right away and pollers
// only broadcast when something actually changed.
let lastAgents = null;
function writeAgents(res, payload) {
  res.write(`event: agents\ndata: ${payload}\n\n`);
}

async function pollAgents() {
  const threads = await fetchThreads(await linkedThreadIds());
  const payload = JSON.stringify({ threads });
  if (payload === lastAgents) return;
  lastAgents = payload;
  for (const res of sseClients) writeAgents(res, payload);
}

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');
  if (lastAgents) writeAgents(res, lastAgents);
  else pollAgents();
  sseClients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

// Poll data.json for external edits (robust across editors that replace the
// file). A change whose hash differs from our last write is an outside edit, so
// we update our baseline and notify subscribers.
setInterval(async () => {
  if (sseClients.size === 0) return;
  try {
    const h = hashData(await readFile(DATA_PATH, 'utf8'));
    if (h !== lastKnownHash) {
      lastKnownHash = h;
      broadcastDataChanged();
    }
  } catch {
    // file missing/mid-write; try again next tick
  }
}, 1000);

// Poll the context files the same way, so an open context page picks up an
// agent's edits. Sends the ids of cards whose context changed.
let lastContextSigs = contextSignatures(CONTEXT_ROOT);
setInterval(() => {
  if (sseClients.size === 0) return;
  try {
    const sigs = contextSignatures(CONTEXT_ROOT);
    const ids = [...new Set([...Object.keys(sigs), ...Object.keys(lastContextSigs)])].filter(
      (id) => sigs[id] !== lastContextSigs[id],
    );
    lastContextSigs = sigs;
    if (!ids.length) return;
    const payload = JSON.stringify({ ids });
    for (const res of sseClients) res.write(`event: context\ndata: ${payload}\n\n`);
  } catch {
    // mid-write; try again next tick
  }
}, 1000);

// Poll T3 Code for thread activity while anyone is watching. Cleared when the
// last subscriber leaves so a reconnect always starts from a fresh read.
let agentsPolling = false;
setInterval(async () => {
  if (sseClients.size === 0) {
    lastAgents = null;
    return;
  }
  if (agentsPolling) return;
  agentsPolling = true;
  try {
    await pollAgents();
  } finally {
    agentsPolling = false;
  }
}, 3000);

// ---------------- project context ----------------
// Cards with context, with their type and last update, for the board.
app.get('/api/context', (_req, res) => {
  res.json({ contexts: listContexts(CONTEXT_ROOT) });
});

function contextRoute(handler) {
  return (req, res) => {
    if (!validCardId(req.params.id)) return res.status(400).json({ error: 'Bad card id' });
    try {
      handler(req, res);
    } catch (e) {
      res.status(e.conflict ? 409 : 400).json({
        error: e.message,
        conflict: !!e.conflict,
        context: readContext(CONTEXT_ROOT, req.params.id),
      });
    }
  };
}

app.get('/api/context/:id', contextRoute((req, res) => {
  res.json({ context: readContext(CONTEXT_ROOT, req.params.id) });
}));

// Create a card's context with the outline for its type.
app.post('/api/context/:id', contextRoute((req, res) => {
  const { type, summary, status, owner, next } = req.body || {};
  initContext(CONTEXT_ROOT, req.params.id, { type, summary, status, owner, next });
  res.json({ context: readContext(CONTEXT_ROOT, req.params.id) });
}));

app.put('/api/context/:id/project', contextRoute((req, res) => {
  setProject(CONTEXT_ROOT, req.params.id, req.body || {}, { backupDir: BACKUP_DIR });
  res.json({ context: readContext(CONTEXT_ROOT, req.params.id) });
}));

// Replace one tab. `baseHash` is the hash of the version the editor started
// from; a different file on disk is a conflict (409) rather than an overwrite.
app.put('/api/context/:id/tabs/:tab', contextRoute((req, res) => {
  const { content, baseHash, label } = req.body || {};
  if (typeof content !== 'string') return res.status(400).json({ error: 'No content' });
  writeTab(CONTEXT_ROOT, req.params.id, req.params.tab, content, {
    baseHash,
    label,
    backupDir: BACKUP_DIR,
  });
  res.json({ context: readContext(CONTEXT_ROOT, req.params.id) });
}));

// Resolve a single pasted link to its title + status, for quick-create.
app.post('/api/resolve', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'No URL provided' });
  if (parsePrUrl(url)) {
    const status = await fetchPr(url);
    return res.json({ kind: 'pr', status });
  }
  if (parseLinearUrl(url)) {
    const status = await fetchLinear(url);
    return res.json({ kind: 'linear', status });
  }
  res.json({
    kind: 'unknown',
    error: 'Unrecognized link (expected a GitHub PR or Linear URL)',
  });
});

// Refresh statuses for a set of PR/Linear URLs. Stateless — client merges results.
app.post('/api/refresh', async (req, res) => {
  const prUrls = [...new Set(req.body?.prUrls || [])];
  const linearUrls = [...new Set(req.body?.linearUrls || [])];
  // Key results by the requested URL, not the fetched entity's canonical URL.
  // A card may link a project as .../slug-id/overview while Linear returns
  // .../slug-id; keying by the request keeps the client's cache lookup (by the
  // card's exact URL) in sync so a refresh actually overwrites its entry.
  const [prs, issues] = await Promise.all([
    Promise.all(prUrls.map(async (url) => [url, await fetchPr(url)])),
    Promise.all(linearUrls.map(async (url) => [url, await fetchLinear(url)])),
  ]);
  res.json({
    prs: Object.fromEntries(prs),
    issues: Object.fromEntries(issues),
  });
});

// My open PRs (across all repos) + Linear issues/projects assigned to me,
// for the "add mine to the board" inbox. Each side degrades independently.
app.get('/api/inbox', async (_req, res) => {
  const [gh, linear] = await Promise.all([fetchMyPrs(), fetchMyLinear()]);
  res.json({ ...gh, ...linear });
});

// Projects in T3 Code, for picking where a card's thread starts.
app.get('/api/t3/projects', async (_req, res) => {
  res.json(await fetchT3Projects());
});

// Start a T3 Code thread for a card: { projectId, prompt, title?, worktree? }.
app.post('/api/t3/threads', async (req, res) => {
  const { projectId, prompt, title, worktree } = req.body || {};
  if (typeof projectId !== 'string' || !projectId) return res.status(400).json({ error: 'No project' });
  if (typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ error: 'No prompt' });
  try {
    res.json(
      await startT3Thread({
        projectId,
        prompt,
        title: typeof title === 'string' ? title.trim() : undefined,
        worktree: worktree !== false,
      }),
    );
  } catch (e) {
    const msg = cleanErr(e);
    res.status(502).json({
      error: /ENOENT/.test(msg) ? `t3 CLI not found (${T3_BIN})` : msg,
    });
  }
});

// Vercel projects the token can see (for the Deployments sidebar toggles).
app.get('/api/vercel/projects', async (_req, res) => {
  try {
    res.json({ projects: await listVercelProjects() });
  } catch (e) {
    res.json({ projects: [], error: cleanErr(e) });
  }
});

// Recent deployments for a set of projects, keyed by projectId. The client
// sends the {id, teamId} pairs it already loaded so we skip re-listing projects.
app.post('/api/vercel/deployments', async (req, res) => {
  const projects = Array.isArray(req.body?.projects) ? req.body.projects : [];
  const limit = Number(req.body?.limit) || 5;
  try {
    const entries = await Promise.all(
      projects.map(async (p) => {
        try {
          return [p.id, await listVercelDeployments(p.id, p.teamId, limit)];
        } catch {
          return [p.id, []];
        }
      }),
    );
    res.json({ deployments: Object.fromEntries(entries) });
  } catch (e) {
    res.json({ deployments: {}, error: cleanErr(e) });
  }
});

// Serve built frontend if present (production).
const dist = join(ROOT, 'dist');
if (existsSync(dist)) app.use(express.static(dist));

app.listen(PORT, HOST, () => {
  console.log(`corvid server on http://${HOST}:${PORT}`);
});
