# The "Suggested by Claude" routine

An optional companion to Corvid: a scheduled Claude Code agent that periodically
scans your issue tracker and Slack for work worth picking up, then writes the
best candidates onto the board as cards. When you have downtime, the suggestions
are already sitting there, sized and linked.

This is not part of the app. Corvid stores the cards; the routine is a separate
prompt you schedule yourself. Everything below is a template to adapt.

## How it hooks into the board

Corvid gives any column whose name contains "claude" special treatment: it's
lifted out of the main board into its own toolbar popover with a count bubble
(see `CLAUDE_MATCH` in `src/App.tsx`). So a column named **"Suggested by
Claude"** stays out of your way until you open it, and the bubble tells you how
many suggestions are waiting.

Add that column to your board once, and the routine owns it from then on.

The routine writes through the bundled Corvid skill
(`.claude/skills/corvid/scripts/tracker.mjs`), so it gets the same one-card-at-a-time
safety guarantees as any other agent edit: ambiguous matches abort, unrelated
cards can't be touched, and every write is backed up. Because the server watches
`data.json`, an open board picks up the new cards on its own.

## Setup

1. **Add the column.** Create a column named `Suggested by Claude` on your board.

2. **Save the prompt.** Put the template below at
   `~/.claude/scheduled-tasks/<routine-name>/SKILL.md`.

3. **Schedule it.** Use the `/schedule` skill in Claude Code to run that prompt
   on a cron schedule. Daily or a few times a week is plenty; the whole point is
   that it's ready before you go looking.

4. **Pre-approve its tools** so it runs unattended without permission prompts.
   In `~/.claude/settings.json` under `permissions.allow`:

   ```jsonc
   {
     "permissions": {
       "allow": [
         "Skill(corvid)",
         "Skill(corvid:*)",
         // Absolute path to the tracker script. This is a literal prefix match.
         "Bash(node /Users/<you>/.claude/skills/corvid/scripts/tracker.mjs:*)",
         "Bash(node /Users/<you>/.claude/skills/corvid/scripts/tracker.mjs *)",
         "Read(//Users/<you>/projects/corvid/**)"
         // Plus the read-only MCP tools for your issue tracker and Slack,
         // listed by their exact tool names.
       ]
     }
   }
   ```

   The path-based rules are why the routine must invoke the script by absolute
   path (see the constraints in the template).

## Unattended-run constraints

These exist because permission rules match on the literal command string. Get
them wrong and the routine stalls on a prompt at 6am with nobody to answer it.

- **Absolute path, never a variable.** `node /abs/path/tracker.mjs list` matches
  the allow rule; `S=…; node $S list` does not.
- **One tracker command per Bash call.** Commands joined by `;` or newlines
  don't match the prefix rule.
- **Use the Read tool for `data.json`**, not `cat` or `node -e`, when pulling
  every card's links for the dedupe set.
- **Stick to read-only tracker/Slack tools** that are allowlisted by name. If a
  new tool is genuinely needed, have the routine note it in its summary rather
  than prompt.

## The prompt template

Replace the `<...>` placeholders with your own scope, teams, and tool names.

```markdown
---
name: corvid-suggested-tasks
description: Build a list of suggested bugs and tasks for me to pick up in downtime
---

Rebuild the "Suggested by Claude" column on my Corvid board with bugs and tasks
worth picking up. This column is AI-managed: wipe it and rewrite it every run.
Anything I actually care about I will have moved to another column, so never
touch cards outside "Suggested".

Load the Corvid skill first and follow it for all board reads and writes.

**Run unattended — do not trigger permission prompts.** This routine is
pre-approved in `~/.claude/settings.json`, but only for these exact shapes:

- Invoke the tracker by its **absolute path**, never via a `S=…; node $S`
  variable. The allow rule is a literal prefix match.
- **One tracker command per Bash call.** Several commands joined by `;` or
  newlines do not match the prefix rule and will prompt.
- Read `tasks-data/data.json` with the **Read tool**, not `node -e` or `cat`,
  when you need every card's links for the dedupe set.
- Stick to the read-only issue-tracker and Slack MCP tools; they are allowlisted
  by name. If a new tool is genuinely needed, note it in the summary instead of
  prompting.

1. **Read my board.** Pull every card in every column, not just "Suggested".
   This is the dedupe set — hold onto titles and any linked Slack/issue URLs.

2. **Gather candidates.**
   - Issue tracker: issues assigned to me, mentioning me, or unassigned in my
     teams, that are open and not already in progress. Include ones filed in the
     last ~2 weeks plus anything stale but still open and clearly actionable.
     Prioritize things in my normal scope of work (<YOUR AREAS>) or in my pillar
     of influence (<YOUR PILLAR>).
   - Slack: search channels I am in for unresolved bug reports, breakage
     reports, and asks directed at me or my area from the last ~7 days. Skip
     threads that already resolved themselves in-thread.
   - Only keep things that are a concrete, actionable piece of work. Drop
     discussion, FYIs, and anything already owned by someone else on the team.
     Some tasks may have assigned leads, but if they're ready for engineering and
     not assigned to an engineer (<YOUR ENG TEAM NAMES>), you can assume it is
     effectively unassigned.

3. **Dedupe.** Drop a candidate if a card already on the board (any column,
   including Done) points at the same issue or Slack thread, or is plainly the
   same piece of work under a different title. When unsure, drop it — a
   duplicate is worse than a miss.

4. **Estimate complexity.** Use the Corvid skill to set a complexity on the card:
   `XS` under an hour, one-line or config change
   `S`  a few hours, single file or obvious fix
   `M`  a day, a few files, some unknowns
   `L`  multiple days, needs design or touches shared code
   `XL` a week-plus, or scope is not yet clear

5. **Write the cards.** For each survivor, create a card in "Suggested" with:
   - the sized title
   - the source link (issue URL or Slack permalink) on the card
   - a body of **one sentence, maximum**, saying why the card is suggested.
     Nothing more — no background, no evidence trail, no repro steps, no second
     sentence. The source link carries the detail.
   - a color tag, if you use them (e.g. ops, bug, experiment)
   - the complexity

   Cap it at 10 cards, best first. Prefer a mix of sizes over ten XS cards.

6. Delete any pre-existing "Suggested" card that did not survive this run.

Do not @mention anyone, do not reply in Slack, do not change issues, and do not
open PRs. This routine only writes to the Corvid board.

Finish with a one-line summary: how many cards written, how many dropped as
duplicates.
```

## Why it's shaped this way

A few choices in there are load-bearing, and worth keeping if you adapt it:

- **Wipe and rebuild every run.** Suggestions go stale fast. Treating the column
  as disposable output means you never curate a backlog of the agent's guesses —
  if a suggestion matters, you drag it to a real column and it's yours.
- **Bias toward dropping.** "When unsure, drop it — a duplicate is worse than a
  miss." A column with three real suggestions is useful; one with ten where four
  are already-done work trains you to ignore it.
- **One sentence, hard cap.** Otherwise the cards grow into essays you won't read,
  and the source link is right there.
- **Read-only everywhere except the board.** No Slack replies, no issue edits, no
  PRs. The routine's only side effect is cards, which makes it safe to run
  unattended.
- **Cap at 10, mixed sizes.** Ten XS cards is a busywork list, not a plan.
