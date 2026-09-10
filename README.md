# Corvid

A local, single-user Kanban board that links ad-hoc tasks to GitHub PRs and Linear
issues and shows their live status as badges. Runs entirely on your machine, with
no database and no accounts: state is a flat `tasks-data/data.json` file.

It's built for the "what am I actually working on right now" problem, where the
answer is spread across a dozen PRs, a few Linear issues, and some deploys.

## Requirements

| | Needed for | Notes |
| --- | --- | --- |
| **Node 18+** | everything | `node -v` |
| **[`gh` CLI](https://cli.github.com/)**, logged in | GitHub PR badges | `gh auth status`. The app shells out to `gh api graphql`, so there's no token to manage. |
| Linear API key | Linear badges | Optional. Set `LINEAR_API_KEY` in `.env.local`. |
| **[Vercel CLI](https://vercel.com/docs/cli)**, logged in | Deployments sidebar | Optional. `vercel login`. The app reads the token the CLI stored; no `.env` entry needed. |

Only Node and `gh` matter for the core experience. Skip Linear and Vercel and
those features simply stay empty.

## Setup

```bash
git clone <your-fork-url> pr-tracker
cd pr-tracker
npm install

# Optional: Linear key and/or overrides
cp .env.example .env.local
$EDITOR .env.local

npm run dev
```

Then open **http://localhost:5473**. The API server runs on `:8787` and Vite
proxies `/api` to it, so you only ever visit the Vite URL in dev.

To run it as one process instead:

```bash
npm run build && npm start   # http://localhost:8787
```

`npm start` serves the built frontend from the same Express server.

## What it does

- **Kanban board** with columns you define yourself; drag cards between them.
  Columns live in `data.json`, so rename or reorder them however you like.
- **Cards** are either ad-hoc (just a title) or a bundle of links: any number of
  GitHub PRs, Linear issues/projects, and freeform links (Slack, Notion, Figma, …).
  Paste a GitHub PR or Linear URL into the quick-add box and it resolves the
  title for you.
- **Refresh** pulls live status for every linked item:
  - **PR:** open / merged / closed / draft, CI rollup (✓ / ✗ / …), review decision
    (approved / changes requested / review required), and unresolved review
    thread count.
  - **Linear:** the issue or project's workflow state, in its own color, plus any
    attached Notion/Figma resources.
- **Inbox** ("My work" sidebar): your open PRs across every repo, plus Linear
  issues assigned to you and projects you lead. One click adds any of them to the
  board.
- **Deployments** sidebar: live Vercel deployment status per project, production
  and preview together, across your personal account and every team you belong to.
  Per-project show/hide toggles.
- **Complexity** meter (XS–XL) and per-card color tags for grouping.
- **Copy prompt for agents**: turns a card into a paste-ready prompt with its
  title, notes, and links, for handing to a coding agent.
- **Hide/unhide** cards, with a toggle to reveal hidden ones.
- **Import / Export** the full state as JSON.

## How it's wired

```
browser (Vite + React, :5473)
   |  /api/*  (proxied)
Express server (server/index.js, 127.0.0.1:8787)
   |-- gh CLI  -> GitHub GraphQL      (your existing gh auth)
   |-- fetch   -> api.linear.app      (LINEAR_API_KEY)
   |-- fetch   -> api.vercel.com      (Vercel CLI token or VERCEL_TOKEN)
   `-- tasks-data/data.json           (all state)
```

- **Frontend:** Vite + React + TypeScript, no state library. `src/App.tsx` holds
  the board; `src/types.ts` is the full data model and the best place to start
  reading.
- **Server:** one ~600-line Express file. It owns every credential and every
  outbound call, so nothing sensitive is ever handed to the browser. It binds to
  `127.0.0.1` only and has no auth of its own; don't expose it.
- **Storage:** `tasks-data/data.json` (git-ignored), which also caches the
  last-fetched status for each PR/issue so badges survive a reload. It lives in
  its own directory so you can sync just `tasks-data/` to Dropbox/Drive without
  dragging along `node_modules`.
- **External edits:** the server watches `data.json` and pushes a server-sent
  event when something other than the UI changes it, so the board reloads
  itself. That makes it safe for a script or coding agent to edit the board file
  directly while it's open.

## Data file

`tasks-data/data.json` is created on first save. The shape (see `src/types.ts`
for the authoritative version):

```jsonc
{
  "columns": ["Todo", "In Progress", "In Review", "Done"],
  "cards": [
    {
      "id": "abc123",
      "title": "Fix checkout redirect",
      "column": "In Review",
      "hidden": false,
      "complexity": "S",
      "links": [
        { "label": "PR", "url": "https://github.com/acme/acme-web/pull/123" },
        { "label": "Issue", "url": "https://linear.app/acme/issue/ENG-42/..." }
      ]
    }
  ],
  "cache": { "prs": {}, "issues": {} },
  "colorTags": { "#3b9eff": "sales" },
  "repoNames": { "acme/acme-web": "web" }
}
```

Two conveniences worth knowing:

- `repoNames` overrides the repo label on PR rows, keyed by `owner/repo`
  (case-insensitive). The example above shows `web #123` instead of
  `acme/acme-web #123`.
- Any column whose name contains "claude" is treated as a suggestions column and
  moved out of the main board into its own toolbar popover with a count badge.
  It's an ordinary column otherwise, useful as a drop target for an agent that
  proposes work.

## Editing the board from an agent

The repo ships a [Claude Code](https://claude.com/claude-code) skill at
`.claude/skills/corvid/` that lets an agent read and edit the board for you:
"add this PR to the checkout card", "move the redirect card to In Review",
"what's in my Todo column". Clone the repo and Claude Code picks it up
automatically when you work in this directory.

It drives `.claude/skills/corvid/scripts/tracker.mjs`, a standalone Node script
with no dependencies, so it's equally usable by hand or from any other agent:

```bash
S=.claude/skills/corvid/scripts/tracker.mjs
node $S where                 # which data.json am I pointed at?
node $S columns               # columns, card counts, color tags
node $S list --all
node $S add-link "checkout redirect" https://github.com/acme/acme-web/pull/317
node $S set "checkout redirect" --column "In Review" --complexity L
node $S add-card --title "New task" --column Todo --top
```

Every mutation targets exactly one card, matched by uuid, title substring, or
link substring; an ambiguous match aborts with the candidates rather than
guessing. It refuses to write if any other card or the card ordering would
change, backs the file up to `~/.pr-tracker-backups/` first (last 20 kept), and
takes `--dry` to preview. Because the server watches `data.json`, an open board
picks up these edits on its own.

By default it targets `tasks-data/data.json` in the repo the skill ships inside,
resolved from the script's own location rather than the working directory. If
your board lives in a different checkout, point `PR_TRACKER_DIR` at it. Linked
git worktrees are refused, since their git-ignored `tasks-data/` is an empty
decoy board.

## Notes and limits

- Single user, single machine, no auth. It is not built to be hosted.
- `tasks-data/` and `.env.local` are git-ignored, so your task list and keys
  never get committed. Use **Export** for backups; **Import** restores.
- CI state comes from GitHub's status-check rollup on the PR's latest commit.
  PRs with no checks show no CI badge.
- Unresolved thread count reads up to 100 review threads per PR.
- The inbox reads up to 100 open PRs and 100 Linear issues/projects.
- Status is fetched on demand, not polled. Hit **Refresh** when you want it
  current.

## License

MIT. See [LICENSE](LICENSE).
