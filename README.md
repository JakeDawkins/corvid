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
- **Deployments** sidebar: live Vercel deployment status per project (production
  and preview together), with per-project show/hide toggles. Opens alongside the
  My work sidebar so both can stack.
- Import / Export the full state as JSON for backup.

## How it's wired

- **Frontend:** Vite + React + TypeScript.
- **Server:** a small Express app (`server/index.js`) that owns all secrets and
  outbound calls. Nothing sensitive touches the browser.
- **GitHub:** uses your existing `gh` CLI auth (`gh api graphql`). No token to manage.
- **Vercel:** reuses the token the Vercel CLI stored at login (`vercel login`),
  same idea as `gh`. Projects across your personal account and all teams are
  listed automatically. Override with `VERCEL_TOKEN` in `.env.local` if needed.
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
4. Vercel (optional, only for the Deployments sidebar): install the
   [Vercel CLI](https://vercel.com/docs/cli) and run `vercel login`. The app
   reads that stored token; no `.env` entry needed unless you set `VERCEL_TOKEN`.
5. Run: `npm run dev`
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
