import express from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_PATH = join(ROOT, 'data.json');

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

const DEFAULT_DATA = {
  columns: [
    'Todo',
    'In Progress',
    'In Review',
    'Addressing Feedback',
    'Top Priority Now',
    'Done',
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
async function writeData(data) {
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2));
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
    return { prs: nodes.filter((n) => n && n.url).map(shapePr) };
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
    links(first:25){ nodes{ url label } }
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

// Shape a Linear issue's attachments / project's links into LinearResources.
// Drops GitHub links (their PRs render as their own cards) and Linear self-links
// so only external resources like Notion specs or Figma designs remain.
function shapeResources(nodes) {
  return (nodes || [])
    .map((n) => ({
      url: n.url,
      title: n.title || n.label || '',
      type: resourceType(n.url),
    }))
    .filter(
      (r) =>
        r.url && !/github\.com/i.test(r.url) && !/linear\.app/i.test(r.url),
    );
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
    resources: shapeResources(p.links?.nodes),
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
  const [prs, issues] = await Promise.all([
    Promise.all(prUrls.map(fetchPr)),
    Promise.all(linearUrls.map(fetchLinear)),
  ]);
  res.json({
    prs: Object.fromEntries(prs.map((p) => [p.url, p])),
    issues: Object.fromEntries(issues.map((i) => [i.url, i])),
  });
});

// My open PRs (across all repos) + Linear issues/projects assigned to me,
// for the "add mine to the board" inbox. Each side degrades independently.
app.get('/api/inbox', async (_req, res) => {
  const [gh, linear] = await Promise.all([fetchMyPrs(), fetchMyLinear()]);
  res.json({ ...gh, ...linear });
});

// Serve built frontend if present (production).
const dist = join(ROOT, 'dist');
if (existsSync(dist)) app.use(express.static(dist));

app.listen(PORT, () => {
  console.log(`gh-pr-tracker server on http://localhost:${PORT}`);
});
