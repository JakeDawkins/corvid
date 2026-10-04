---
name: watch-and-fix
description: Continuously monitor your open pull requests for CI failures, review comments, and change requests, then automatically fix and resolve what's fixable. Use when the user says "watch this PR", "watch and fix", "keep an eye on my PR", or asks Claude to babysit a PR until it's mergeable.
---

# Watch and Fix

Continuously monitors one or more pull requests and resolves failures, comments, and review feedback automatically where it's safe to do so.

## Scope

- Applies to PRs the user points at explicitly (a PR URL/number), or, if none is given, the user's own open PRs in the current repo.
- Never touches PRs authored by other people unless the user explicitly names one.
- Runs until the user stops it, the PR is merged/closed, or a fix requires a judgment call (see "When to stop and ask").

## Poll loop

Every ~30 seconds:

1. Fetch the PR's current state: CI/check status, new or unresolved review comments, new reviews (approve/changes-requested/comment).
2. If nothing new since the last pass, wait and check again.
3. If there's something new, work through it using the rules below, then continue polling.

Use `gh pr checks`, `gh pr view --comments`, `gh api` for review threads, etc. — whatever's available in the repo's toolchain.

## Handling CI failures

- Read the failure logs, not just the status.
- If the failure is caused by this PR's changes: fix the code, run the relevant tests/lint locally if possible, commit, and push.
- If the failure looks unrelated to this PR (flaky test, pre-existing failure on main, infra/CI outage, dependency/service blip): do **not** try to fix it. Leave a short note (in a commit message or as a PR comment) saying it looks unrelated and why, and move on.
- Never force-push over commits you didn't just make. Never rewrite history beyond your own fix commits.
- If the same check fails again after your fix, stop auto-retrying after 2 attempts on the same failure — flag it for the user instead of looping.

## Handling review comments / change requests

- For each new unresolved comment or thread:
  - Judge whether the comment is valid (correct, actionable, matches the code as written) or not (based on a misreading, already addressed, out of scope, or simply a matter of preference the user has already decided against).
  - **If valid:** make the code change, commit, push, then resolve the thread. Reply briefly on the thread stating what changed.
  - **If not valid:** reply on the thread explaining why (concisely, with reasoning, not dismissively), then resolve it. Don't silently dismiss — always leave a reply justifying the call.
- Never resolve a thread without either fixing the code or explaining why no fix was made.
- Treat comments about security, data loss, auth, or payments as valid by default unless clearly mistaken — don't argue those away without being very sure.

## When to stop and ask instead of acting

- The requested change conflicts with another part of the PR or the ticket/spec it's implementing.
- Fixing a comment would require a design decision (e.g. changing an API shape, picking between two valid approaches).
- CI is red for a reason that isn't clearly this PR's fault and isn't clearly unrelated either.
- The same fix attempt has failed twice.

In these cases, post a comment on the PR (or tell the user directly) explaining the situation and pause on that item — keep polling and handling everything else.

## Notes

- Keep a running mental log of what you've fixed/resolved each pass so you don't redo work or re-explain the same thing twice.
- Prefer small, focused commits per fix over one large batched commit.
- This skill pushes code and resolves conversations on the user's behalf — it should only run against repos/PRs the user has pointed it at.
