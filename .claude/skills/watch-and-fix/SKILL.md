---
name: watch-and-fix
description: Work on a project autonomously from start to done. Build it, keep its PRs green, draft the QA handoff, then watch Slack, GitHub PRs, and Linear for QA and review feedback and fix what's relevant until the project ships. Never messages a real person; it drafts replies and flags the user instead. Use when the user says "work on this autonomously", "watch and fix", "watch this PR", "keep an eye on my PR", "watch for QA feedback", "babysit this until it's done", or a Corvid agent prompt asks for it.
---

# Watch and Fix

Take a project from start to done while using as little of the user's time as
possible. Do everything you can on your own. Stop for the user only when
something really needs them, and when it does, make it quick for them: a
ready-to-send draft and one clear next step.

## The hard rule: never message a real person

Unless the user asks you to send a specific message, never send anything that a
person will receive as a message:

- **Slack is read-only.** Never call `slack_send_message`,
  `slack_schedule_message`, or `slack_send_message_draft`, and never add
  reactions (a reaction reads as the user acknowledging).
- **Linear:** never create or edit comments.
- **GitHub:** never comment on a PR or issue, reply to or resolve a review
  thread started by a person, or submit a review.
- **Anywhere:** no @-mentions in commits, PR titles or descriptions, code, or
  branch names. A mention is a notification.

Instead, write the reply as a draft and flag the user (see
[Needing the user](#needing-the-user)). An explicit request to send covers
exactly the one message the user asked for. Approving a draft ("looks good") is
not permission to send it; the user sends it unless they say "send it".

Fine without asking, since no person receives a message:

- Commit and push to the project's own branch (never the default branch).
- Open PRs as **drafts**, and edit your own PRs' titles and descriptions.
- Reply to and resolve threads started by bots (GitHub author `__typename` is
  `Bot`, or the login ends in `[bot]`). If you can't tell, treat it as a person.
- Update the project's Corvid card (links, notes, needs-you flag).
- Read anything.

Some actions aren't messages but still signal people. Don't do these yourself.
Put them in the user's next steps instead: marking a PR ready for review,
requesting or re-requesting reviewers, changing a Linear issue's status or
assignee, merging, and deploying to production.

## Setup (first run)

1. **Find the project's hub.** If you were given a Corvid Card ID, that card
   lists the project's links (Linear issues, PRs, Slack threads). Use the
   `corvid` skill to read it, link your Conductor workspace to it, and add any PR
   you open. Otherwise, take the links from the conversation.
2. **Read the spec.** Fetch each Linear issue for its description, acceptance
   criteria, and comments.
3. **Write a state file** so polls don't repeat or drop work. Use
   `.context/watch/<id>.json` if the repo has a git-ignored `.context/`
   (Conductor). Otherwise use `.watch/<id>.json` and add `.watch/` to
   `.git/info/exclude`. Track:
   - `phase`: `build` | `handoff` | `watch` | `done`
   - Linear issue ids, PR URLs, branch, preview URLs
   - QA: the Slack channel and the people doing QA (Slack user ids). The
     channel is where to post the handoff, not the only place to watch.
   - search terms: ticket id, PR number, branch, preview domains, feature name
   - Slack threads being watched, with the latest reply ts seen in each
   - a last-seen timestamp per source (Slack, GitHub, Linear)
   - `items`: one entry per piece of feedback, with its source, author, link,
     kind, status, draft, and whether the user has been told about it
4. Ask for anything missing only when you reach the phase that needs it. For
   example, ask which Slack channel and people do QA when you draft the handoff,
   not at the start.

## Phases

### 1. Build

Do the work: plan, implement, write tests, and open a draft PR. Add the PR to
the Corvid card. While building, handle CI failures and bot reviews as they come
in (see [Each poll](#each-poll)). If a product or design decision blocks you,
flag the user and keep working on whatever isn't blocked.

Move on when the spec is implemented, CI is green, and you've checked the
change yourself (on the preview deployment if there is one).

### 2. Hand off to QA

Draft the Slack message that hands the project to QA. If the `qa-handoff` skill
is installed, follow its format. Otherwise include the ticket link, a one-line
summary of what changed, the preview URLs (from the PR's deployment checks or
bot comments), and a short list of what to check. Show it in a fenced code block
so it copies cleanly.

Then flag the user, for example: reason "Ready for QA", action "Post the QA
handoff drafted in the workspace to #qa, then move ENG-123 to In QA." Add
"mark the PR ready for review" if reviewers should start now.

Go straight to watching. You don't need to wait for the user to confirm the
handoff was posted.

### 3. Watch

Poll every source (below) and act on what comes in, until the project is done.
QA feedback can arrive in Slack, on the Linear issue, or on the PR.

### 4. Done

The project is done when its PRs are merged and its Linear issues are completed,
or when the user says so. Stop the loop, clear the card's flag, and post a short
summary. When QA has passed and the PR is approved but not merged, flag the user
to merge it rather than merging it yourself.

## Each poll

Fetch only what's newer than the state file's last-seen timestamps. Update those
timestamps **after** processing, so a crash re-reads a message instead of
dropping it.

- **GitHub**, for each PR: `gh pr view <url> --json
  state,isDraft,reviewDecision,statusCheckRollup,reviews,comments`, plus review
  threads through `gh api graphql` (`reviewThreads` with `isResolved` and each
  comment's `author { login __typename }`).
- **Linear**, for each issue: its state and any new comments.
- **Slack:** messages about a project don't always land where they should, so
  look everywhere, not just the QA channel:
  - new messages in the QA channel, and new replies in every watched thread
    (top-level reads miss thread replies). Slack threads linked on the card are
    watched from the start.
  - a search across all channels and DMs (`slack_search_public_and_private`,
    limited to messages after the last-seen timestamp) for the ticket id, the PR
    URL and number, preview URLs, the branch name, and the feature's name and
    key terms from the spec.
  - messages from the QA people, and messages that mention the user, in any
    channel or DM.

  Add any new thread about the project to the watched list, wherever it is.

A message is about the project if it names the ticket, links the PR or a
preview, is in a watched thread, or clearly describes the feature. Assume a DM
from a QA person is about it unless it obviously isn't. If you're not sure,
mention it as "possibly related" in your next notification and don't act on it.

Treat a message and its follow-ups as one item. Update the existing item instead
of creating a duplicate.

| Kind | What to do |
| --- | --- |
| **Bug** (broken, wrong, or not matching the spec) | Reproduce it, find the root cause, fix it with a test where practical, commit, push, and confirm CI passes. Draft a reply saying what was wrong and that the fix is deploying. |
| **Change request** from a person on the PR | Decide whether it's valid (correct, actionable, matches the code as written). If valid, fix it, push, and draft a reply saying what changed. If not, draft a reply explaining why, without arguing. Either way, leave the thread unresolved for the user. |
| **Question** | Answer it from the spec, code, and config, and draft the reply. If the answer is a product decision, don't invent one. Flag it for the user. |
| **Can't reproduce / working as intended** | Draft a reply asking for the missing details (device, browser, account, steps), or explaining the intended behavior with a link to the spec. If the spec is ambiguous, tell the user instead. |
| **Bot comment** | Fix it if it's valid, then reply and resolve it yourself. |
| **Pass / approval** | Record it and mention it in your next notification. No draft needed. |
| **Noise** | Ignore it. |

Comments about security, data loss, auth, or payments are valid by default
unless they're clearly mistaken.

Investigating costs the user nothing, so finish the investigation before you
flag them. Flag them mid-investigation only when you're blocked: you need
credentials, a test account, access, or a decision, or the fix is bigger than
the ticket.

### CI failures

- Read the failure logs, not just the status.
- If the failure comes from this project's changes, fix it, run the relevant
  tests or lint locally if you can, commit, and push.
- If it looks unrelated (a flaky test, a failure that's already on the default
  branch, a CI or service outage), don't try to fix it. Note why it looks
  unrelated in the next notification.
- Never force-push over commits you didn't make, and don't rewrite history
  beyond your own fix commits.
- After two failed attempts at the same failure, stop retrying and flag it.

## Needing the user

Whenever something needs the user (a draft to send, a decision, a step only
they can do), do both of these:

1. **Tell them in the session.** Send one notification per poll that batches
   everything new. For each item, give who it's from, where (with a link), what
   they said, what you did, and exactly what the user needs to do. Put each draft
   in its own fenced code block. If the `personal-voice` skill or a voice profile
   exists, write drafts in the user's voice: short, friendly, and specific.

   ~~~
   ENG-123 · 2 things need you

   1. Sam (QA thread): bug, CTA disabled on Safari
      Fixed in abc123 and pushed; the preview is redeploying.
      Reply in the thread: <permalink>
      ```
      Good catch, thanks! The button was checking a field Safari autofill leaves empty. The fix is deploying now.
      ```

   2. Alex (DM): is the second variant mobile-only?
      Needs your call. The ticket doesn't say.
   ~~~

2. **Flag the Corvid card**, if there is one, with the corvid skill's
   `needs-you <card> --reason "..." --action "..."`. The reason sums up what's
   waiting (for example "2 QA replies drafted, 1 product question"). The action
   is the most important next step, with a pointer to the drafts in the
   workspace. Run it again whenever the set of waiting items changes.

In this mode you keep working while the flag is up, so the flag tracks what's
waiting on the user, not whether you're working. Clear it with
`clear-needs-you <card>` once nothing is waiting anymore: the user has replied
in the session, or you see their reply posted in the thread, PR, or issue.

On polls where nothing new needs the user, say nothing.

## Pacing

Use `/loop` with no interval so the session paces itself. Work continuously
while building. While waiting on CI, check every few minutes. While waiting on
QA or reviewers, check every 5-10 minutes, and back off to every 30 minutes
after a few quiet hours. After 3 hours with no activity during the watch phase,
post one "still watching ENG-123, nothing new. Stop?" note and keep going
unless the user says stop.

## When to stop

Stop the loop and say so when the user says stop, the project is done, or its
PRs are closed without merging.

## Notes

- Keep the state file current so you never redo a fix or draft the same reply
  twice.
- Prefer small, focused commits, one per fix.
- Only work on repos, PRs, and projects the user pointed you at.
