export type Link = { label: string; url: string };

// An external resource linked on a Linear issue (attachment) or project (link),
// e.g. a Notion spec or Figma design. `type` drives its badge in the UI.
export type LinearResource = {
  url: string;
  title?: string;
  type?: "figma" | "notion" | "link";
};

export type Card = {
  id: string;
  title: string;
  column: string;
  hidden: boolean;
  notes?: string;
  color?: string;
  // A flat list of links (GitHub PRs, Linear issues/projects, and misc URLs).
  // Each link's kind is derived from its URL via linkKind(), not stored.
  links: Link[];
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
