// A card's project context: the shared memory that agents read before they
// start and update as they work, shown in the app as the card's context page.
//
// Each card with context has a directory next to data.json:
//
//   tasks-data/context/<card id>/
//     project.json      header: type, summary, status, owner, next, dates, extra tab labels
//     <tab>.md          one Markdown file per tab (business.md, decisions.md, ...)
//
// The tabs and their outlines follow the project registry template
// (github.com/Homeaglow/project-registry-template): a project is a regular
// project, a bug, or research, and the type decides the required tabs. Any
// other .md file in the directory is an extra tab.
//
// No dependencies, so both the server and tracker.mjs can import it.

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  copyFileSync,
  unlinkSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const TYPES = ['regular', 'bug', 'research'];

export const TYPE_LABELS = { regular: 'Regular project', bug: 'Bug', research: 'Research' };

// The question each tab answers and how to use it. The app shows the question
// under the tab title, and the guide while the tab is still empty.
export const TABS = {
  business: {
    label: 'Business',
    question: 'Why are we doing this, and how will we know that it worked?',
    guide:
      'The problem in plain words: who has it, how often, and what it costs. Then what the project changes and what it does not. A metrics table turns the goal into numbers: one primary metric, a few guardrails, and a baseline and target for each. Close with the expected impact and its assumptions.',
  },
  bug: {
    label: 'Bug',
    question: 'What broke, how bad was it, and why?',
    guide:
      'Start with the impact: what failed, when it started and stopped, who was affected, and how many. Keep observed facts apart from estimates. Then the root cause in three parts: the direct cause, the trigger, and the condition that let it happen, with evidence.',
  },
  summary: {
    label: 'Summary',
    question: 'What did we ask, and what did we find?',
    guide:
      'The question and why it matters, then the answer first. A findings table with a source and read date for each row, what the data cannot prove, the scope, the open questions, and any follow-up projects. When a finding changes the answer, update this tab first.',
  },
  decisions: {
    label: 'Decisions',
    question: 'What did we decide, and what is still open?',
    guide:
      'One block per decision: the question, the options, the choice, the reason, and the consequence. Add a block the moment someone must choose, not after. Settled and reversed decisions stay, because they explain why the system looks the way it does.',
  },
  implementation: {
    label: 'Implementation',
    question: 'How does it work, and what is built?',
    guide:
      'A diagram of the systems and the data flow, then an honest delivery table: done, partial or mock, and not done. For a bug, show the system before and after the fix. End with the rollout and the way back.',
  },
  qa: {
    label: 'QA plan',
    question: 'What must we prove, and where is the proof?',
    guide:
      'A checklist written at the start, from the spec and the decisions. Each check gets a status and evidence (a test, a video, a screenshot, or a query) as you build. Include negative checks: the message that must not be sent, the row that must not be written. Then the run log, the issues found, and the exit criteria.',
  },
  monitoring: {
    label: 'Monitoring plan',
    question: 'What do we watch after release?',
    guide:
      'The signals, where to see them, and the action when one goes wrong. The owner and backup, the schedule, and when monitoring can stop. For a bug, the invariant that must always hold. Mark each rule as proposed until it is really active.',
  },
  'learn-more': {
    label: 'Learn more',
    question: 'What are you learning about this area as you build?',
    guide:
      'A notebook for the person building the project: how the data flows, why a rule exists, which old decision still shapes the code. When something surprises you, or you ask "why does it work like this?", add a note here, with a small diagram when it helps.',
  },
  references: {
    label: 'References',
    question: 'Where is everything?',
    guide:
      'Every link a reader needs, in one place: the ticket, the spec, the designs, the queries, the Slack threads, the pull requests. Each with a note on what it contains and when someone read it.',
  },
};

// Required tabs per type, in order. Extra tabs go after them, except in
// research, where finding tabs go between Summary and References.
const TYPE_TABS = {
  regular: ['business', 'decisions', 'implementation', 'qa', 'monitoring', 'learn-more', 'references'],
  bug: ['bug', 'decisions', 'implementation', 'qa', 'monitoring', 'learn-more', 'references'],
  research: ['summary', 'references'],
};

export const DECISION_STATUSES = ['Open', 'Proposed', 'Settled', 'Deferred', 'Reversed'];
export const QA_STATUSES = ['Pass', 'Fail', 'Blocked', 'Not run', 'Skipped'];

const RULES = `<!-- Write what is true. When you do not know something, write "unknown" and
the work that will find it. Do not invent metrics, causes, decisions, or state. -->`;

const QA_OUTLINE = (first) => `<!-- Write the checklist when the work starts, from the spec, the decisions,
and the design. Fill in status and evidence as you build. Status is one of
Pass, Fail, Blocked, Not run, or Skipped (the page colors and counts them). A
check is Pass only with evidence: a test file, a video, a screenshot, a CI run,
or rows. Number checks QA-01, QA-02, ... and never renumber. Record a failure as
Fail, even when it is not fixed yet. Start the tab with:

- Status: Not started, In progress, Passed, or Blocked
- Owner: Name
- Last run: YYYY-MM-DD, R1
-->

## Test setup

<!--
| Item | How |
| --- | --- |
| Environment | Local, PR preview, or staging, with the builds |
| Test data | Fixtures or test accounts |
| Overrides and flags | Experiment overrides or feature settings |
| Sign-in | How each role signs in |
| Recording | Tool for videos and screenshots |
-->

## Checklist

<!-- Group checks by flow, one table per flow (### Flow name). ${first}
Include negative checks: what must not happen.

| ID | Check and expected result | Source | How and where | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| QA-01 | What happens, and the expected result | Spec line, D01, or design frame | Automated, manual, or data check; platform | Not run | |
-->

## Run log

<!-- One entry per test session, newest first. Do not edit old entries.

| Run | Date | Environment and build | Scope | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| R1 | YYYY-MM-DD | Environment and short commits | QA-01, QA-02 | Pass, or what failed | Links |
-->

## Issues found

<!--
| ID | Issue | Found in | Fix | State |
| --- | --- | --- | --- | --- |
| I-01 | Defect | R1 | Commit or PR | Open / Fixed / Worked around |
-->

## Exit criteria and gaps

<!-- What must pass before release, and what is not tested on purpose, with the reason. -->
`;

const MONITORING_OUTLINE = (extra) => `<!-- Checks after release. Tests belong in the QA plan, release steps in
Implementation. Mark proposed rules as proposed: a plan on a page is not an
active alert. Do not invent thresholds. Start the tab with:

- Status: Not started, Planned, Active, Stopped, or Complete
- Owner and backup: Names, or the work needed to assign them
- Schedule and observation period: Frequency, start, and duration
- Last check and result: Date, result, and evidence, or Not checked
-->

## Signals

<!--${extra}
| Signal | Source | Threshold | Response and owner |
| --- | --- | --- | --- |
| Signal | Dashboard, query, or log | Confirmed value, or proposed | Action and owner |
-->

## Completion

<!-- When monitoring can stop or hand over to normal operations, and what is still missing. -->
`;

const REFERENCES_OUTLINE = (groups) => `<!-- Every link a reader needs, in one place. A link used in another tab must
also be here. For each link, say what it contains and when it was read, or
"Not read". Use only verified URLs: never build one from an ID or a title.
Leave out a group with no items. Groups, in this order when they apply:
${groups}
The card's own links and Conductor workspaces show in the page header on their
own. List other agent workspaces (T3 Code threads, other machines) under
"Agent workspaces".

## Ticket and plan

- [ENG-123 Title](https://linear.app/...): Linear ticket, scope and acceptance criteria. Read on YYYY-MM-DD.
-->
`;

const DECISIONS_OUTLINE = (stage) => `<!-- One block per decision, in the format below. The page groups them by
status: Open and Proposed first, then Settled, then Deferred and Reversed.
Status is one of Open, Proposed, Settled, Deferred, or Reversed. Never delete a
decision: mark it Reversed and add a new one. Do not infer approval from a task
being done; an unapproved plan stays Proposed.

### D01: The question or decision, as a short title

- Status: Open
- Date: YYYY-MM-DD
- Owner: Name${stage}
- Context: Why this decision is needed
- Options: The options considered
- Decision: The selected direction, or the answer needed while open
- Reason: Why
- Consequences: What this enables, blocks, or changes
- Evidence: [Source](https://...)
-->
`;

// Starting content for each tab of each type: headings plus guidance in HTML
// comments, which the page hides. A tab that is only headings and comments
// counts as empty.
const OUTLINES = {
  business: () => `${RULES}

## Problem or opportunity

<!-- The problem in plain words: who has it, how often, and what it costs. -->

## Goal and scope

<!-- The result this project must produce. What is in scope and out of scope. -->

## Business metrics

<!-- One primary metric and the guardrails, each with a baseline and a target.

| Metric | Role | Baseline | Target | Window | Source |
| --- | --- | --- | --- | --- | --- |
| Metric | Primary | Value or unknown | Value or unknown | Period | Source |
| Metric | Guardrail | Value or unknown | Limit or unknown | Period | Source |
-->

## Expected impact

<!-- The expected result and the path from the change to it. Time horizon,
confidence, main assumptions, and possible negative effects. Use a number only
when evidence supports it. -->
`,
  bug: () => `${RULES}

## Impact

<!-- What failed, when it started and stopped, who or what was affected, and how
many. Keep observed facts apart from estimates. No personal data.

| Measure | Observed value | Source | Confidence |
| --- | --- | --- | --- |
| Start and end | Time range | Source | Level |
| Affected volume | Value | Source | Level |
| Business effect | Value or unknown | Source or needed work | Level |
-->

## Current status

<!-- Active, contained, repaired, or under observation. -->

## Root cause

### Direct cause

<!-- The technical cause. -->

### Trigger

<!-- The event that started the failure. -->

### System conditions

<!-- Why the system let it happen or continue. -->

### Evidence

<!-- Logs, queries, tests, code paths, or a reproduction. Separate symptoms and
contributing factors from the cause. -->
`,
  summary: () => `${RULES}

<!-- Start the tab with "- Status: Open, Answered, or Stopped", with the date and reason. -->

## Question

<!-- The question as one sentence, and why it matters. -->

## Current answer

<!-- The answer so far, first. When new data reverses it, lead with the correction. -->

## Key findings

<!-- Every row names its source and the date someone read it.

| Finding | Value | Source | Read on |
| --- | --- | --- | --- |
| Finding | Number or result | Query, dashboard, or document | YYYY-MM-DD |
-->

## What the data cannot prove

<!-- Missing comparisons, unconfirmed causes, partial windows, unmeasured impact. -->

## Scope

<!-- In scope and out of scope, including any fix. A fix becomes its own card. -->

## Open questions and next step

<!-- Open questions and the work that answers each, the next step and its owner,
and links to follow-up cards. Add one finding tab per line of evidence. -->
`,
  decisions: (type) => DECISIONS_OUTLINE(type === 'bug' ? '\n- Stage: Containment, Repair, or Prevention' : ''),
  implementation: (type) =>
    type === 'bug'
      ? `## Before the repair

<!-- The failed flow and the failure point. A Mermaid diagram (\`\`\`mermaid) helps. -->

## After the repair

<!-- The new flow, its controls, and its boundaries. -->

## Repair plan and state

<!--
| Change | Purpose | State | Evidence | Owner |
| --- | --- | --- | --- | --- |
| Containment or repair | Purpose | Done / Partial / Not done | Evidence | Owner |
-->

## Data repair and rollback

<!-- Data repair needed or not, the rollback condition and action, and a link to the QA plan. -->
`
      : `## System and data flow

<!-- What this project owns and what connected systems own, and how data moves
between them. A Mermaid diagram (\`\`\`mermaid) helps; color nodes by state. -->

## Delivery state

<!-- The honest status of each part.

| Module or capability | State | Evidence now | Missing work | Related decision |
| --- | --- | --- | --- | --- |
| Item | Done / Partial or mock / Not done | Evidence | Gap | D01 |
-->

## Rollout and rollback

<!-- Safety controls, rollout stages, the rollback condition and action, and a link to the QA plan. -->
`,
  qa: (type) =>
    QA_OUTLINE(
      type === 'bug'
        ? 'Start with a check that reproduces the bug before the fix and passes after it, then the regression and data-repair checks.'
        : 'Write one check for each expected result in the spec and each settled decision.',
    ),
  monitoring: (type) =>
    MONITORING_OUTLINE(
      type === 'bug' ? '\nStart with the invariant: the rule that must always be true from now on.\n' : '',
    ),
  'learn-more': (type) =>
    type === 'bug'
      ? `<!-- A notebook for the person fixing the bug, in plain words: the system around
the bug, its normal flow, important data and vocabulary, the modules involved
(repository path and entry point), ownership, failure modes, and safe ways to
inspect it. Link code, dashboards, and runbooks. -->
`
      : `<!-- A notebook for the person building the project, in plain words: how the
current system works, its vocabulary, dependencies, and anything that surprised
you. Keep decisions in Decisions. -->
`,
  references: (type) =>
    REFERENCES_OUTLINE(
      type === 'research'
        ? 'Ticket and plan, Research and data (every query, dashboard, document, and\nweb source, with the date it was read), Slack and meetings, Agent workspaces,\nRelated projects.'
        : type === 'bug'
          ? 'Ticket and plan, Dashboards and runbooks, Legal and policy, Research and\ndata, Slack and meetings, Code (PRs, branches), Agent workspaces, Related\nprojects.'
          : 'Ticket and plan, Design, Legal and policy, Research and data, Slack and\nmeetings, Code (PRs, branches), Agent workspaces, Related projects.',
    ),
};

const CARD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const TAB_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function validCardId(id) {
  return typeof id === 'string' && CARD_ID_RE.test(id);
}

// A tab id from a name: "Experiment design" -> "experiment-design".
export function tabId(name) {
  const id = String(name)
    .toLowerCase()
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!TAB_ID_RE.test(id)) throw new Error(`bad tab name ${JSON.stringify(name)}`);
  return id;
}

function titleize(id) {
  const s = id.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// tasks-data/context, next to data.json.
export function contextRoot(dataPath) {
  return join(dirname(dataPath), 'context');
}

export function cardDir(root, cardId) {
  if (!validCardId(cardId)) throw new Error(`bad card id ${JSON.stringify(cardId)}`);
  return join(root, cardId);
}

export function hashText(text) {
  return createHash('sha1').update(text).digest('hex');
}

// True when a tab has nothing but headings and comments, as an outline starts.
export function isEmptyTab(content) {
  return !String(content)
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((l) => !/^\s*#{1,6}\s/.test(l))
    .join('')
    .trim();
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Tabs in display order, each with its file and whether the type requires it.
function orderTabs(project, files) {
  const required = TYPE_TABS[project.type] || TYPE_TABS.regular;
  const labels = Object.fromEntries((project.extraTabs || []).map((t) => [t.id, t.label]));
  const listed = (project.extraTabs || []).map((t) => t.id);
  const present = files.map((f) => f.replace(/\.md$/, ''));
  // Extras keep the order they were added in, then any unlisted files by name.
  const extras = [
    ...listed.filter((id) => present.includes(id) && !required.includes(id)),
    ...present.filter((id) => !required.includes(id) && !listed.includes(id)).sort(),
  ];
  const tab = (id, isRequired) => ({
    id,
    file: `${id}.md`,
    label: labels[id] || TABS[id]?.label || titleize(id),
    required: isRequired,
  });
  const req = required.map((id) => tab(id, true));
  const ext = extras.map((id) => tab(id, false));
  // Research puts finding tabs before References.
  if (project.type === 'research') return [...req.slice(0, -1), ...ext, req[req.length - 1]];
  return [...req, ...ext];
}

// The card's context, or null if it has none. Tabs include their content and a
// hash of it, so an editor can tell when a file changed under it.
export function readContext(root, cardId) {
  const dir = cardDir(root, cardId);
  const project = readJson(join(dir, 'project.json'));
  if (!project) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.md') && TAB_ID_RE.test(f.slice(0, -3)));
  const tabs = orderTabs(project, files).map((t) => {
    const path = join(dir, t.file);
    const content = existsSync(path) ? readFileSync(path, 'utf8') : '';
    return {
      ...t,
      question: TABS[t.id]?.question,
      guide: TABS[t.id]?.guide,
      content,
      hash: hashText(content),
      empty: isEmptyTab(content),
    };
  });
  return { dir, project, tabs };
}

// Card ids with context, with their type and last update.
export function listContexts(root) {
  if (!existsSync(root)) return {};
  const out = {};
  for (const id of readdirSync(root)) {
    if (!validCardId(id)) continue;
    const project = readJson(join(root, id, 'project.json'));
    if (project) out[id] = { type: project.type, updated: project.updated };
  }
  return out;
}

// A signature of every file under the context root, to notice outside edits.
export function contextSignatures(root) {
  if (!existsSync(root)) return {};
  const out = {};
  for (const id of readdirSync(root)) {
    if (!validCardId(id)) continue;
    const dir = join(root, id);
    try {
      out[id] = readdirSync(dir)
        .sort()
        .map((f) => {
          const s = statSync(join(dir, f));
          return `${f}:${s.mtimeMs}:${s.size}`;
        })
        .join('|');
    } catch {
      // removed mid-scan
    }
  }
  return out;
}

const KEEP_BACKUPS = 50;

// Copy a file into the backup dir before it's overwritten, keeping the newest
// KEEP_BACKUPS context backups.
function backupFile(path, backupDir, cardId) {
  if (!backupDir || !existsSync(path)) return null;
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = path.split('/').pop();
  const dest = join(backupDir, `context.${cardId.slice(0, 8)}.${stamp}.${name}`);
  copyFileSync(path, dest);
  const old = readdirSync(backupDir)
    .filter((f) => f.startsWith('context.'))
    .sort((a, b) => a.split('.')[2].localeCompare(b.split('.')[2]))
    .slice(0, -KEEP_BACKUPS);
  for (const f of old) unlinkSync(join(backupDir, f));
  return dest;
}

function writeProject(dir, project) {
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2) + '\n');
}

const PROJECT_FIELDS = ['summary', 'status', 'owner', 'next'];

// Create a card's context with the outline for its type. Refuses if it exists.
export function initContext(root, cardId, { type = 'regular', ...fields } = {}) {
  if (!TYPES.includes(type)) throw new Error(`type must be one of ${TYPES.join(', ')}`);
  const dir = cardDir(root, cardId);
  if (existsSync(join(dir, 'project.json'))) throw new Error(`card ${cardId} already has context at ${dir}`);
  mkdirSync(dir, { recursive: true });
  const project = { type };
  for (const k of PROJECT_FIELDS) project[k] = typeof fields[k] === 'string' ? fields[k] : '';
  project.created = today();
  project.updated = today();
  project.extraTabs = [];
  for (const id of TYPE_TABS[type]) {
    const path = join(dir, `${id}.md`);
    if (!existsSync(path)) writeFileSync(path, OUTLINES[id](type));
  }
  writeProject(dir, project);
  return dir;
}

// Update header fields. Changing the type adds outlines for its new required
// tabs and keeps every existing file.
export function setProject(root, cardId, fields, { backupDir } = {}) {
  const dir = cardDir(root, cardId);
  const path = join(dir, 'project.json');
  const project = readJson(path);
  if (!project) throw new Error(`card ${cardId} has no context`);
  const changes = [];
  if (fields.type !== undefined && fields.type !== project.type) {
    if (!TYPES.includes(fields.type)) throw new Error(`type must be one of ${TYPES.join(', ')}`);
    changes.push(`type: ${project.type} -> ${fields.type}`);
    project.type = fields.type;
    for (const id of TYPE_TABS[fields.type]) {
      const tabPath = join(dir, `${id}.md`);
      if (!existsSync(tabPath)) writeFileSync(tabPath, OUTLINES[id](fields.type));
    }
  }
  for (const k of PROJECT_FIELDS) {
    if (typeof fields[k] === 'string' && fields[k] !== project[k]) {
      changes.push(`${k}: ${JSON.stringify(fields[k])}`);
      project[k] = fields[k];
    }
  }
  if (!changes.length) return { changes };
  backupFile(path, backupDir, cardId);
  project.updated = today();
  writeProject(dir, project);
  return { changes };
}

// Replace (or append to) one tab. A tab that isn't one of the type's tabs is
// an extra tab, labelled `label` (or the id) in the page's tab list. With
// `baseHash`, refuses when the file changed since that version was read.
export function writeTab(root, cardId, tab, content, { append = false, label, baseHash, backupDir } = {}) {
  const dir = cardDir(root, cardId);
  const projectPath = join(dir, 'project.json');
  const project = readJson(projectPath);
  if (!project) throw new Error(`card ${cardId} has no context; create it first`);
  const id = tabId(tab);
  const path = join(dir, `${id}.md`);
  const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (baseHash !== undefined && baseHash !== hashText(before)) {
    const err = new Error(`${id}.md changed since it was read`);
    err.conflict = true;
    throw err;
  }
  let next = String(content);
  if (append && before) next = `${before.replace(/\n*$/, '')}\n\n${next}`;
  if (!next.endsWith('\n')) next += '\n';
  const changed = before !== next;
  const backup = changed ? backupFile(path, backupDir, cardId) : null;
  if (changed) writeFileSync(path, next);
  const required = TYPE_TABS[project.type] || [];
  project.extraTabs ||= [];
  const extra = project.extraTabs.find((t) => t.id === id);
  let relabeled = false;
  if (!required.includes(id)) {
    if (!extra) {
      project.extraTabs.push({ id, label: label || titleize(id) });
      relabeled = true;
    } else if (label && label !== extra.label) {
      extra.label = label;
      relabeled = true;
    }
  }
  if (changed || relabeled) {
    project.updated = today();
    writeProject(dir, project);
  }
  return { id, path, changed, backup, hash: hashText(next) };
}
