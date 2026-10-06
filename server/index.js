import express from 'express';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'tasks-data');
const DATA_PATH = join(DATA_DIR, 'data.json');

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
// project is tagged with its teamId so deployment lookups hit the right scope.
async function listVercelProjects() {
  const scopes = [undefined];
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
      projects.push({ id: p.id, name: p.name, teamId, teamSlug: scope?.slug });
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

// ---------------- Conductor (agent activity) ----------------
// Conductor keeps its workspace and session state in a local SQLite file. We read
// it (read-only, via the sqlite3 CLI that ships with macOS) to tell whether an
// agent is working in any workspace linked on a card. The schema is internal to
// Conductor, so any failure just means "no activity info", never a board error.
const CONDUCTOR_DB =
  process.env.CONDUCTOR_DB ||
  join(homedir(), 'Library', 'Application Support', 'com.conductor.app', 'conductor.db');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Run a read-only query against Conductor's database and parse its rows.
async function queryConductor(sql) {
  const { stdout } = await execFileP(
    'sqlite3',
    ['-readonly', '-json', '-cmd', '.timeout 2000', CONDUCTOR_DB, sql],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  // sqlite3 prints nothing (not "[]") when there are no rows.
  return stdout.trim() ? JSON.parse(stdout) : [];
}

// How far back to look for scheduled wakeups and background tasks. Claude Code
// caps a wakeup at 1h and a background command at 2h, so anything older has
// fired or ended (or its session died without saying so).
const WAIT_LOOKBACK_MS = 2 * 60 * 60 * 1000;
// A wakeup counts as pending a little past its due time, so the gap between it
// firing and the session flipping to "working" doesn't flash "idle".
const WAKE_GRACE_MS = 2 * 60 * 1000;

// What idle sessions in these workspaces are waiting on, keyed by workspace
// local_id: background tasks (Bash run_in_background, Monitor, background
// agents) that haven't ended, and the next ScheduleWakeup of a /loop. Either
// re-invokes the agent on its own, so the workspace is "waiting", not "idle".
async function fetchWaits(localIds) {
  if (!localIds.length) return {};
  const list = localIds.map((id) => `'${id}'`).join(',');
  const since = new Date(Date.now() - WAIT_LOOKBACK_MS).toISOString();
  const rows = await queryConductor(`
    select s.workspace_id as ws, s.id as session, m.sent_at as at, m.content as content
    from sessions s join session_messages m on m.session_id = s.id
    where s.workspace_id in (${list}) and m.sent_at > '${since}'
      and (m.content like '{"type":"system","subtype":"task_started"%'
        or m.content like '{"type":"system","subtype":"task_updated"%'
        or m.content like '{"type":"system","subtype":"task_notification"%'
        or m.content like '%"name":"ScheduleWakeup"%')
    order by m.sent_at`);
  const tasks = new Map(); // task_id -> { ws, description, background, done }
  const wakeups = new Map(); // session id -> { ws, at (ms) } for its latest wakeup
  for (const r of rows) {
    let msg;
    try {
      msg = JSON.parse(r.content);
    } catch {
      continue;
    }
    if (msg.type === 'system') {
      const task = tasks.get(msg.task_id);
      if (msg.subtype === 'task_started') {
        tasks.set(msg.task_id, {
          ws: r.ws,
          description: msg.description,
          background: msg.is_backgrounded === true,
          done: false,
        });
      } else if (task && msg.subtype === 'task_updated') {
        if (msg.patch?.is_backgrounded) task.background = true;
        if (msg.patch?.status) task.done = true;
      } else if (task && msg.subtype === 'task_notification') {
        task.done = true;
      }
    } else if (msg.type === 'assistant') {
      for (const c of msg.message?.content || []) {
        if (c.type !== 'tool_use' || c.name !== 'ScheduleWakeup') continue;
        // A newer call replaces the session's pending wakeup; stop cancels it.
        if (c.input?.stop) {
          wakeups.delete(r.session);
        } else {
          const delay = Math.min(3600, Math.max(60, Number(c.input?.delaySeconds) || 0));
          wakeups.set(r.session, { ws: r.ws, at: Date.parse(r.at) + delay * 1000 });
        }
      }
    }
  }
  const out = {};
  const entry = (ws) => (out[ws] ||= { waitingOn: [] });
  for (const t of tasks.values()) {
    if (t.background && !t.done) entry(t.ws).waitingOn.push(t.description || 'Background task');
  }
  const now = Date.now();
  for (const w of wakeups.values()) {
    if (w.at + WAKE_GRACE_MS < now) continue;
    const e = entry(w.ws);
    if (!e.wakeAt || w.at < e.wakeAt) e.wakeAt = w.at;
  }
  return out;
}

// Status for each requested workspace id, keyed by that id. Ids Conductor
// doesn't know (deleted, or from another machine) are simply absent.
async function fetchWorkspaces(ids) {
  // Ids are interpolated into SQL, so only well-formed UUIDs get through.
  const wanted = [...new Set(ids)].filter((id) => UUID_RE.test(id));
  if (!wanted.length) return { workspaces: {} };
  if (!existsSync(CONDUCTOR_DB)) {
    return { workspaces: {}, error: `Conductor database not found at ${CONDUCTOR_DB}` };
  }
  const list = wanted.map((id) => `'${id}'`).join(',');
  const sql = `
    select w.local_id as local_id, w.id as id, w.directory_name as name,
      w.branch as branch, w.state as state, r.name as repo,
      max(case when s.status = 'working' then 1 else 0 end) as working
    from workspaces w
    left join repos r on r.id = w.repository_id
    left join sessions s on s.workspace_id = w.local_id
    where w.local_id in (${list}) or w.id in (${list})
    group by w.local_id`;
  try {
    const rows = await queryConductor(sql);
    // Waits are a refinement of "idle"; if reading them fails, fall back to
    // working/idle rather than dropping the whole status.
    const waits = await fetchWaits(
      rows.filter((r) => r.working !== 1 && r.state !== 'archived').map((r) => r.local_id),
    ).catch(() => ({}));
    const out = {};
    for (const r of rows) {
      const wait = r.working === 1 ? undefined : waits[r.local_id];
      const status = {
        name: r.name,
        repo: r.repo,
        branch: r.branch,
        state: r.state,
        activity: r.working === 1 ? 'working' : wait ? 'waiting' : 'idle',
        working: r.working === 1,
      };
      if (wait?.waitingOn.length) status.waitingOn = wait.waitingOn;
      if (wait?.wakeAt) status.wakeAt = new Date(wait.wakeAt).toISOString();
      for (const id of [r.local_id, r.id]) if (wanted.includes(id)) out[id] = status;
    }
    return { workspaces: out };
  } catch (e) {
    return { workspaces: {}, error: cleanErr(e) };
  }
}

// Repos added to Conductor, in sidebar order, for a card's repo picker. root_path
// is what a conductor:// deep link's `path` matches to pick the repo.
async function fetchConductorRepos() {
  if (!existsSync(CONDUCTOR_DB)) {
    return { repos: [], error: `Conductor database not found at ${CONDUCTOR_DB}` };
  }
  const sql = `
    select name, root_path as path from repos
    where coalesce(hidden, 0) = 0 and root_path is not null
    order by display_order, name`;
  try {
    return { repos: await queryConductor(sql) };
  } catch (e) {
    return { repos: [], error: cleanErr(e) };
  }
}

// Workspace ids linked on any card, read from disk so a link added by the UI or
// a skill is picked up on the next poll.
async function linkedWorkspaceIds() {
  const data = await readData();
  return (data.cards || []).flatMap((c) => (Array.isArray(c.workspaces) ? c.workspaces : []));
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
// also carries `agents` events with the Conductor status of linked workspaces.
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
  const payload = JSON.stringify(await fetchWorkspaces(await linkedWorkspaceIds()));
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

// Poll Conductor for agent activity while anyone is watching. Cleared when the
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

// Repos in Conductor, for picking where a card's workspace starts.
app.get('/api/conductor/repos', async (_req, res) => {
  res.json(await fetchConductorRepos());
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
  console.log(`gh-pr-tracker server on http://${HOST}:${PORT}`);
});
