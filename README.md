# PR Tracker

A local, single-user Kanban board that links ad-hoc tasks to GitHub PRs and Linear
issues, and shows their live statuses as badges. Runs entirely on your machine.
No database — state is a flat `data.json` file with JSON import/export.

## What it does

- Kanban board with manual columns; drag cards between them.
- Cards are ad-hoc (just a title) or linked to a Linear issue + any number of GitHub PRs.
- Paste in freeform links (Slack, Notion, Figma, …).
- **Refresh** button pulls live status for every linked PR/issue:
  - **PR:** open / merged / closed / draft, CI (✓ / ✗ / …), review decision
    (approved / changes requested / review required), and **unresolved review thread count**.
  - **Linear:** the issue's workflow state (with its color).
- Hide/unhide cards; toggle to show hidden.
- Import / Export the full state as JSON for backup.

## How it's wired

- **Frontend:** Vite + React + TypeScript.
- **Server:** a small Express app (`server/index.js`) that owns all secrets and
  outbound calls. Nothing sensitive touches the browser.
- **GitHub:** uses your existing `gh` CLI auth (`gh api graphql`). No token to manage.
- **Linear:** GraphQL API with a personal API key from `.env.local`.
- **Storage:** `data.json` in the repo root (git-ignored). Includes the last-fetched
  status cache so badges survive reloads.

## Setup

1. Requirements: Node 18+, and the [`gh` CLI](https://cli.github.com/) logged in
   (`gh auth status` to check).
2. Install: `npm install`
3. Linear key (optional, only for Linear badges):
   - Copy `.env.example` to `.env.local`
   - Get a key at Linear → Settings → Security & access → Personal API keys
   - Set `LINEAR_API_KEY=...`
4. Run: `npm run dev`
   - App: http://localhost:5473 (server on :8787, proxied automatically)

## Production-ish single process

`npm run build && npm start` builds the frontend and serves it from the Express
server at http://localhost:8787.

## Notes

- `data.json` is git-ignored so your task list / PR URLs don't get committed. Use
  **Export** to back it up. **Import** restores it.
- CI state reflects GitHub's status-check rollup on the PR's latest commit; PRs with
  no checks show no CI badge.
- Unresolved thread count looks at up to 100 review threads per PR.
