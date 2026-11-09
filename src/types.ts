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
  // Archived. Kept under its original name, "hidden", so existing boards and
  // agents keep working.
  hidden: boolean;
  notes?: string;
  color?: string;
  complexity?: Complexity;
  // Due date as YYYY-MM-DD (a day, no time). The card shows the days left,
  // tinted by urgency per Data.dueThresholds.
  dueDate?: string;
  // A flat list of links (GitHub PRs, Linear issues/projects, and misc URLs).
  // Each link's kind is derived from its URL via linkKind(), not stored.
  links: Link[];
  // T3 Code thread ids for this card, so the board shows where it already has
  // a conversation and whether an agent is working in it. Linked by "Start in
  // T3", by an agent, or by pasting the id. A card can have several.
  threads?: string[];
  // T3 Code project id that "Start in T3" last started a thread in for this
  // card, as listed by /api/t3/projects.
  t3Project?: string;
  needsYou?: NeedsYou;
  // ISO timestamps: when the card was created, last changed, and last
  // archived (archivedAt, removed when it's unarchived). Cards from before these
  // existed may lack them, so treat all three as optional.
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string;
};

// A project in T3 Code. `path` is its root directory.
export type T3Project = { id: string; name: string; path: string };

// Live T3 Code status for one linked thread, read from T3's local database.
export type ThreadStatus = {
  title?: string;
  // T3's environment id, needed for the t3code:// deep link.
  environmentId?: string;
  archived?: boolean;
  // working: a run is in progress. waiting: a run is paused on the user (an
  // approval or a question). idle: neither.
  activity: "working" | "waiting" | "idle";
};

// Live status of the T3 Code threads linked on cards, pushed by the server
// over SSE, keyed by thread id. Ids T3 doesn't know are absent.
export type AgentsStatus = {
  threads?: Record<string, ThreadStatus>;
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
  // Where the card detail view's advance button moves a card, keyed by its
  // current column. A column with no entry advances to the next column on the
  // board; an empty string turns the button off for that column.
  nextColumns?: Record<string, string>;
  // When a card's due date counts as urgent or soon. Defaults in Due.tsx.
  dueThresholds?: DueThresholds;
};

// Days left at or under which a due date is shown as urgent, then as soon.
// Further out, the card just shows the days left.
export type DueThresholds = { urgentDays: number; soonDays: number };

// A Vercel project (personal or under a team), used for the Deployments sidebar.
export type VercelProject = {
  id: string;
  name: string;
  teamId?: string;
  teamSlug?: string;
  // Dashboard page on vercel.com. Absent when the account's scope is unknown.
  url?: string;
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

// A card's project fields (project.json), shown in its context page's sidebar.
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
