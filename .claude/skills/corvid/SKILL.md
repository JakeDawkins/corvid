---
name: corvid
description: Read and edit the Corvid board's data.json (a local Kanban of tasks with Linear, GitHub, Slack, Figma and Notion links). Use when the user asks to add/update/move/hide a card, attach a PR or Linear or Slack or Figma link to an existing card, add notes, set a card color, set a card's complexity/size (XS/S/M/L/XL), link the current Conductor workspace to a card, flag a card as needing the user (or clear that flag), create a new card, or asks what's on the board / in a column. Also use at the start of any task that references a Corvid Card ID, to link the Conductor workspace to that card.
---

# Corvid board edits

The board is a local single-user app whose entire state is one flat file. Use
`scripts/tracker.mjs` in this skill directory for all mutations; it is the only
safe way to touch the file (see Rules).

## The one file that counts

**`<repo>/tasks-data/data.json`**, where `<repo>` is the Corvid checkout this
skill ships inside. The script derives that path from its own location, so it
works from any working directory without configuration.

Copies exist and are decoys:

- A linked git worktree or a second clone is a separate checkout. `tasks-data/`
  is git-ignored, so a fresh one has none — but running `npm run dev` there makes
  the server create an **empty** `tasks-data/data.json` on first save. It looks
  like a valid board and contains nothing.

So:

- The script resolves the path from its own location, never from the current
  directory. Don't `cd` anywhere first, and don't build a path from `pwd`.
- Do **not** pass `--data` or set `PR_TRACKER_DIR` unless the user explicitly
  names a different file. The default is correct.
- Paths inside a linked worktree or any other non-main checkout are refused.
  `--allow-nonstandard` overrides that, and is only for when the user has
  explicitly asked for that copy.
- Every command prints `# data: <path>` first. If that path is not the checkout
  you expect, stop and check before continuing.
- `node $S where` prints the resolved path, the repo root, the env override, and
  the card count — use it if there's any doubt about the target.

## Data shape

```
{
  "columns": ["Backlog", "Todo", "In Progress", "In Review", "Done"],
  "cards": [ Card, ... ],          // array order = display order within a column
  "cache": { "prs": {...}, "issues": {...} },   // app-owned, never hand-edit
  "colorTags": { "#3b9eff": "Ops" },            // optional color -> name map
  "repoNames": { "acme/acme-web": "web" },      // optional repo label overrides
  "hiddenRepos": ["acme/old-app"],              // optional, PRs left out of My work
  "hiddenVercelProjects": ["acme-docs"]         // optional, projects left out of Deployments
}
```

A `Card`:

```
{
  "id": "447d0491-eaec-465d-8f62-02c30c83a84d",  // uuid, never change it
  "title": "Fix checkout redirect",
  "column": "Done",                 // must be one of columns[]
  "hidden": true,
  "notes": "",                      // optional, free text
  "color": "#3b9eff",               // optional, one of the preset hexes below
  "complexity": "M",                // optional, t-shirt size XS|S|M|L|XL
  "links": [ { "label": "", "url": "https://..." } ],
  "workspaces": ["1037e896-2225-4a69-8609-03832bde673e"],  // optional
  "repo": "/Users/jane/code/acme-web",  // optional, Conductor repo root path
  "needsYou": {                     // optional, set/cleared by agents
    "reason": "Plan ready for review",
    "action": "Open the workspace and approve or redirect the plan",
    "since": "2026-10-04T16:52:16.084Z"
  }
}
```

- **`links` is one flat list** of every URL on the card — GitHub PRs, Linear
  issues/projects, Slack permalinks, Figma, Notion, anything. There is no
  per-type field. The app derives each link's kind from its URL shape
  (`github.com/<org>/<repo>/pull/<n>` -> PR, `linear.app/.../issue/ABC-12` or
  `linear.app/.../project/...` -> Linear, everything else generic), so just
  append the URL and the badge follows.
- `label` is usually `""`. Set it only when the user gives display text.
- Preset colors: `#e5484d` red, `#f76b15` orange, `#ffb224` yellow, `#30a46c`
  green, `#3b9eff` blue, `#8e4ec6` purple, `#e93d82` pink. `colorTags` names
  some of them, so if the board maps `#ffb224` to `BUG`, "tag it BUG" means
  `--color BUG`. Run `columns` to see the board's actual tags.
- **`complexity`** is an optional t-shirt size, one of `XS S M L XL` (stored
  uppercase). It renders as a 1-5 bar meter under the card title; omit the field
  (or set `none`) to leave the card unsized and hide the meter. Input is
  case-insensitive, so `--complexity l` and `--complexity L` both set `L`.
- **`workspaces`** is an optional list of Conductor workspace ids (UUIDs, the
  value of `$CONDUCTOR_WORKSPACE_ID`). A card can have several, e.g. one per
  repo. Each shows as a badge at the top of the card, which turns into an
  orange "Working" badge while an agent is working in that workspace, or a softer "Waiting" badge while the agent is
  idle but has a background task or scheduled wakeup pending. Use `link-workspace` / `unlink-workspace`; never
  hand-edit it.
- **`repo`** is an optional Conductor repo root path. The app's "Start in
  Conductor" button opens new workspaces for the card there. It's set from the
  app; leave it alone unless the user asks.
- **`needsYou`** marks a card as waiting on the user: why the agent stopped
  and what the user should do. It shows as a banner on the card, high-contrast
  in the columns the user picked in Settings (`needsYouColumns`) and muted
  elsewhere. Use `needs-you` / `clear-needs-you`; never hand-edit it.
- `cache` holds the last-fetched PR/Linear statuses. Adding a link does not
  populate it; the badge appears after the user hits **Refresh** in the app.

## Commands

```bash
S=.claude/skills/corvid/scripts/tracker.mjs   # or an absolute path to it

node $S where                        # resolved data.json path + card count
node $S columns                      # columns + card counts + color tags
node $S list                         # visible cards; --column NAME, --hidden, --all
node $S show <query>                 # full JSON of one card
node $S add-link <query> <url> [--label TEXT] [--first]
node $S remove-link <query> <url>
node $S link-workspace <query> [workspace-id]     # default: $CONDUCTOR_WORKSPACE_ID
node $S unlink-workspace <query> [workspace-id]   # default: $CONDUCTOR_WORKSPACE_ID
node $S needs-you <query> --reason TEXT --action TEXT
node $S clear-needs-you <query>
node $S set <query> [--title T] [--column C] [--color HEX|NAME|none]
                    [--complexity XS|S|M|L|XL|none]
                    [--notes N] [--append-notes N] [--hidden true|false]
node $S add-card --title T [--column C] [--link URL]... [--color C]
                 [--complexity XS|S|M|L|XL] [--notes N] [--hidden] [--top]
node $S add-column <name> [--after EXISTING]
node $S validate                     # schema + JSON check
```

`<query>` picks the card by uuid, uuid prefix (4+ chars), a case-insensitive
substring of the title, a substring of any link URL, or an exact linked
workspace id (so `show $CONDUCTOR_WORKSPACE_ID` finds the card this workspace
is working on). **Exactly one card must
match** — zero or multiple aborts with the candidate list, so a vague query can
never edit the wrong card.

Add `--dry` to any mutation to preview it without writing.

## Workflow

1. Find the card first: `list` or `show` with the user's words. If the query is
   ambiguous, show the candidates and ask which one — do not guess.
2. Make the change with a single command per intent. One card per command.
3. Report what changed (the script prints it).

Example — "add the web PR to the checkout redirect card":

```bash
node $S show "checkout redirect"
node $S add-link "checkout redirect" https://github.com/acme/acme-web/pull/317
```

## Linking a Conductor workspace

When you start working on a card from inside Conductor (`$CONDUCTOR_WORKSPACE_ID`
is set), link the workspace to it so the board can show that an agent is
actively on it:

```bash
node $S link-workspace <card id>
```

It defaults to `$CONDUCTOR_WORKSPACE_ID` and is a no-op if the card already has
that workspace, so it's safe to run every time. Only link the card you were told
to work on (the "Card ID" in a copied agent prompt, or one the user named). Don't
link a workspace to a card you are merely reading or editing on the user's
behalf, and don't guess a card from the branch name. Outside Conductor the
variable is unset and the command fails; skip it there.

## Flagging a card that needs the user

When you are working on a card (you linked your workspace to it, or were given
its Card ID) and you stop because something is waiting on the user, flag it
before ending your turn:

```bash
node $S needs-you <card id> --reason "<why you stopped>" --action "<what to do>"
```

- `--reason` is one short sentence on why you stopped, e.g. "Plan ready for
  review" or "Tests need a staging API key I don't have".
- `--action` is the concrete next step for the user, e.g. "Approve or redirect
  the plan in the workspace" or "Add STAGING_KEY to .env.local, then tell me
  to continue". Name the place to do it.
- Running it again replaces the message and resets its timestamp.

Clear it as soon as nothing is waiting on the user anymore. Usually that's
when they reply and you start working again; an agent that keeps working while
waiting (like `watch-and-fix`) clears it once the user has dealt with
everything:

```bash
node $S clear-needs-you <card id>
```

It's a no-op if there's no flag, so it's safe to run whenever you resume. Don't flag a card when you're finished and nothing is waiting on the user.

## Rules

- **Only the card the user named.** Never reorder, re-title, re-column, or
  reformat anything else. The script enforces this: it aborts if any other card
  or the card ordering would change.
- Use the script rather than rewriting `data.json` by hand or with a whole-file
  Write. A full rewrite risks reordering cards, dropping `cache`, and changing
  formatting. If a request genuinely needs something the script can't express,
  say so and propose adding a subcommand.
- Never invent link URLs. Use exactly what the user pasted, or a URL confirmed
  from a tool result. Do not guess PR numbers or Linear issue ids.
- Never edit `cache` — it is regenerated by the app's Refresh.
- If a command reports 0 cards or an unfamiliar board, you are almost certainly
  pointed at a decoy copy, not an empty board. Check `where` before writing.
- Only use existing column names. If the user names a column that doesn't
  exist, list the real ones and ask — don't create one to make a command
  succeed. When they do ask for a new column, use `add-column`; never hand-edit
  `columns[]`. It appends by default, or takes `--after EXISTING` to position
  it. There is no way to add one at position 0, on purpose: the app's quick-add
  and this script's `add-card` both fall back to `columns[0]`, so an empty
  column there would start swallowing new cards.
- Adding a column is not reversible with this script (there is no
  `remove-column`, since it would orphan cards), so confirm the exact name
  first.
- Deleting a card is not a script command on purpose. If the user wants one
  gone, prefer `set <query> --hidden true`; only hard-delete if they explicitly
  ask, and confirm the exact card first.
- `data.json` is git-ignored, so there is no git history to recover from. Every
  mutation writes a timestamped backup to `~/.pr-tracker-backups/` (last 20
  kept).

## Live-app caveat

The server watches `data.json` and pushes a server-sent event when it changes
from outside the UI, so an open board reloads this skill's edits on its own. No
manual reload needed.

The one exception: the page autosaves its whole in-memory state ~400ms after any
change, and a pending save wins over an incoming file change. So if the user
drags a card or types in the app in the same moment the script writes, the edit
can still be overwritten. If they are actively using the board, ask them to pause
or reload before making a batch of changes.
