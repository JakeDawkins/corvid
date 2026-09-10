---
name: corvid
description: Read and edit the Corvid board's data.json (a local Kanban of tasks with Linear, GitHub, Slack, Figma and Notion links). Use when the user asks to add/update/move/hide a card, attach a PR or Linear or Slack or Figma link to an existing card, add notes, set a card color, set a card's complexity/size (XS/S/M/L/XL), create a new card, or asks what's on the board / in a column.
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
  "repoNames": { "acme/acme-web": "web" }       // optional repo label overrides
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
  "links": [ { "label": "", "url": "https://..." } ]
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
node $S set <query> [--title T] [--column C] [--color HEX|NAME|none]
                    [--complexity XS|S|M|L|XL|none]
                    [--notes N] [--append-notes N] [--hidden true|false]
node $S add-card --title T [--column C] [--link URL]... [--color C]
                 [--complexity XS|S|M|L|XL] [--notes N] [--hidden] [--top]
node $S validate                     # schema + JSON check
```

`<query>` picks the card by uuid, uuid prefix (4+ chars), a case-insensitive
substring of the title, or a substring of any link URL. **Exactly one card must
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
  exist, list the real ones and ask; don't add a column unless they ask for one
  (that means editing `columns[]` directly, so confirm first).
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
