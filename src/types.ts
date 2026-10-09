export type Link = { label: string; url: string };

// T-shirt sizing for a card's estimated complexity, smallest to largest. Its
// rank (XS=1 … XL=5) drives the 5-segment bar meter shown on the card.
export type Complexity = "XS" | "S" | "M" | "L" | "XL";

// An external resource linked on a Linear issue (attachment) or project (link),
// e.g. a Notion spec or Figma design. `type` drives its badge in the UI.
export type LinearResource = {
  url: string;
  title?: string;
  type?: "figma" | "notion" | "link";
};

// Set by an agent when it has stopped and something is waiting on the user:
// why it stopped and what to do next. The agent clears it when it resumes.
export type NeedsYou = {
  reason: string;
  action: string;
  // ISO timestamp of when the agent set it.
  since: string;
};

export type Card = {
  id: string;
  title: string;
  column: string;
  hidden: boolean;
  notes?: string;
  color?: string;
  complexity?: Complexity;
  // A flat list of links (GitHub PRs, Linear issues/projects, and misc URLs).
  // Each link's kind is derived from its URL via linkKind(), not stored.
  links: Link[];
  // Conductor workspace ids (CONDUCTOR_WORKSPACE_ID) doing work for this card.
  // A card can span several workspaces, e.g. one per repo. The board shows an
  // activity indicator while an agent is working in any of them.
  workspaces?: string[];
  // Root path of the Conductor repo to start new workspaces for this card in
  // (e.g. "/Users/jane/code/my-app"), as listed by /api/conductor/repos.
  repo?: string;
  needsYou?: NeedsYou;
};

// A repo added to Conductor. `path` is its root directory.
export type ConductorRepo = { name: string; path: string };

// Live Conductor status for one linked workspace, pushed by the server over SSE.
export type WorkspaceStatus = {
  name?: string;
  repo?: string;
  branch?: string;
  // Conductor's workspace state, e.g. "ready" or "archived".
  state?: string;
  // working: an agent is mid-turn. waiting: idle, but a background task or a
  // scheduled wakeup (/loop) will re-invoke it on its own. idle: neither.
  // Absent from servers that predate it; fall back to `working`.
  activity?: "working" | "waiting" | "idle";
  // True while any session in the workspace has an agent working.
  working: boolean;
  // While waiting: descriptions of the background tasks it's waiting on.
  waitingOn?: string[];
  // While waiting: when the next scheduled wakeup fires (ISO).
  wakeAt?: string;
};

export type AgentsStatus = {
  workspaces: Record<string, WorkspaceStatus>;
  error?: string;
  // Conductor's database couldn't be opened because the app is closed.
  notRunning?: boolean;
};

export type PrStatus = {
  url: string;
  title?: string;
  number?: number;
  state?: "OPEN" | "CLOSED" | "MERGED";
  isDraft?: boolean;
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  unresolvedThreads?: number;
  totalThreads?: number;
  ci?: "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | "EXPECTED" | null;
  fetchedAt?: string;
  error?: string;
};

export type IssueStatus = {
  url: string;
  identifier?: string;
  title?: string;
  stateName?: string;
  stateColor?: string;
  stateType?: "backlog" | "unstarted" | "started" | "completed" | "canceled";
  resources?: LinearResource[];
  fetchedAt?: string;
  error?: string;
};

export type Cache = {
  prs: Record<string, PrStatus>;
  issues: Record<string, IssueStatus>;
};

export type Data = {
  columns: string[];
  cards: Card[];
  cache?: Cache;
  // User-assigned names for accent colors, keyed by color value (e.g.
  // "#3b9eff" -> "sales"). Shown as a tag on any card using that color.
  colorTags?: Record<string, string>;
  // Display-name overrides for GitHub repos, keyed by "owner/repo"
  // (case-insensitive, e.g. "acme/acme-web" -> "web"). When set, the
  // override replaces the "owner/repo" text shown on PR rows.
  repoNames?: Record<string, string>;
  // GitHub repos ("owner/repo") whose PRs are left out of My work, and Vercel
  // project names left out of Deployments. Both matched case-insensitively.
  hiddenRepos?: string[];
  hiddenVercelProjects?: string[];
  // Columns where a card's "Needs you" message is shown high-contrast. In other
  // columns it is shown muted.
  needsYouColumns?: string[];
  // Board columns drawn with an accent tint so they stand out.
  highlightedColumns?: string[];
  // Board columns shown in focus mode, toggled from the header.
  focusColumns?: string[];
};

// A Vercel project (personal or under a team), used for the Deployments sidebar.
export type VercelProject = {
  id: string;
  name: string;
  teamId?: string;
  teamSlug?: string;
};

export type VercelDeployment = {
  uid: string;
  name: string;
  url: string;
  state: string;
  // READY | BUILDING | ERROR | QUEUED | INITIALIZING | CANCELED
  readyState: string;
  target?: string | null;
  branch?: string;
  // GitHub org/repo and PR number for the commit this deployment built, when it
  // came from a branch with an open PR. Used to link a deployment to a board card.
  org?: string;
  repo?: string;
  prNumber?: number;
  creator?: string;
  createdAt: number;
  inspectorUrl?: string;
};

// My open PRs + Linear issues/projects assigned to me, for the inbox.
export type Inbox = {
  prs: PrStatus[];
  issues: IssueStatus[];
  projects: IssueStatus[];
  githubError?: string;
  linearError?: string;
};

// ---- Project context (memory) ----
// Each card can have a project context: Markdown tabs that agents read before
// they start and keep current as they work, stored in
// tasks-data/context/<card id>/ next to data.json. See
// .claude/skills/corvid/scripts/context.mjs.

// The type decides the required tabs: regular and bug projects get Business
// (or Bug), Decisions, Implementation, QA plan, Monitoring plan, Learn more,
// and References; research gets Summary and References, with finding tabs
// between them.
export type ContextType = "regular" | "bug" | "research";

// The header of a card's context page (project.json).
export type ContextProject = {
  type: ContextType;
  summary?: string;
  status?: string;
  owner?: string;
  next?: string;
  // YYYY-MM-DD.
  created?: string;
  updated?: string;
  extraTabs?: { id: string; label: string }[];
};

export type ContextTab = {
  id: string;
  file: string;
  label: string;
  // Required by the type, as opposed to an extra tab.
  required: boolean;
  // The question the tab answers, and how to fill it in (standard tabs only).
  question?: string;
  guide?: string;
  content: string;
  // Hash of `content`, sent back on save so an outside edit isn't overwritten.
  hash: string;
  // Only headings and comments, as the outline starts.
  empty: boolean;
};

export type CardContext = {
  dir: string;
  project: ContextProject;
  tabs: ContextTab[];
};

// Which cards have context, for the board and card editor.
export type ContextIndex = Record<string, { type: ContextType; updated?: string }>;
