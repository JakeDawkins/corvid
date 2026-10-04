# Generates docs/workflow.svg, the development workflow diagram in the README.
# Run: python3 docs/workflow.py
from pathlib import Path
from xml.sax.saxutils import escape as e

W, LABEL_W, COL_W, M = 1640, 150, 210, 20
steps = ["Intake", "Kick off", "Build", "QA handoff", "QA + review", "Ship", "Close out"]
HEAD_Y, HEAD_H = 84, 54
lanes = [("Human", 190), ("Agent", 220), ("Corvid shows", 120)]
LANE_Y0 = HEAD_Y + HEAD_H + 16

# kind: gate | ask | agent | none | board
cells = {
 "Human": [
  ("ask",  ["Pick what to work on", "Add from My work", "or paste a link"], []),
  ("gate", ["Click Start in", "Conductor"], []),
  ("ask",  ["Answer blocking", "product or design", "questions"], []),
  ("gate", ["Post handoff in Slack", "Linear to In QA", "PR ready for review", "Request reviewers"], []),
  ("gate", ["Send drafted replies", "Make product calls", "Resolve human threads"], []),
  ("gate", ["Merge the PR", "Deploy to production", "Start or ship the", "experiment", "Close the Linear issue"], []),
  ("gate", ["Move card to Done", "or hide it"], []),
 ],
 "Agent": [
  ("agent", ["Scheduled routine", "suggests cards"], ["corvid"]),
  ("agent", ["Link workspace", "to the card"], ["corvid"]),
  ("agent", ["Implement + test", "Draft PR, add to card", "Set up Statsig exp", "Test in a browser", "Fix CI + bot comments"], ["watch-and-fix", "corvid"]),
  ("agent", ["Draft handoff message", "with previews and", "Statsig overrides", "Flag the card"], ["watch-and-fix", "qa-handoff"]),
  ("agent", ["Watch Slack, PRs, Linear", "Fix bugs + push", "Re-test in a browser", "Draft replies"], ["watch-and-fix"]),
  ("agent", ["Flag ready to merge", "Detect merge", "Stop loop, clear flag"], ["watch-and-fix", "corvid"]),
  ("none",  ["Not automated", "yet"], []),
 ],
 "Corvid shows": [
  ("board", ["Suggested popover", "Backlog cards"], []),
  ("board", ["Working badge"], []),
  ("board", ["PR + Linear status", "Needs you if blocked"], []),
  ("board", ["Needs you:", "Ready for QA"], []),
  ("board", ["Needs you: N drafts", "Preview deployments"], []),
  ("board", ["Needs you:", "Ready to merge", "Prod deployments"], []),
  ("board", ["Card leaves", "the board"], []),
 ],
}
STY = {
 "gate":  dict(fill="#ffb224", stroke="#d48c00", text="#1a1300", dash=None, weight=600),
 "ask":   dict(fill="#fff6dd", stroke="#d9a320", text="#5c4300", dash="5 4", weight=400),
 "agent": dict(fill="#fbe9e2", stroke="#d97757", text="#4a2414", dash=None, weight=400),
 "none":  dict(fill="#f4f5f7", stroke="#b8bec8", text="#7a808b", dash="5 4", weight=400),
 "board": dict(fill="#e9f1f8", stroke="#5b8fb0", text="#1f3a4d", dash=None, weight=400),
}
LANE_LABEL_COLOR = {"Human": "#b07800", "Agent": "#c15f3c", "Corvid shows": "#3a6f93"}

def colx(i): return M + LABEL_W + i * COL_W
out = []
lane_total = sum(h for _, h in lanes) + 10 * (len(lanes) - 1)
H = LANE_Y0 + lane_total + 190
out.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W*2}" height="{H*2}" viewBox="0 0 {W} {H}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif">')
out.append('<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#646a75"/></marker>'
           '<marker id="arrO" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#d97757"/></marker></defs>')
out.append(f'<rect width="{W}" height="{H}" fill="#ffffff"/>')
out.append(f'<text x="{M}" y="40" font-size="24" font-weight="700" fill="#1c1f24">Development workflow with Corvid</text>')
out.append(f'<text x="{M}" y="62" font-size="14" fill="#646a75">Amber boxes are the human gates that move a project forward. Everything else runs on its own.</text>')

# step header with arrows
for i, s in enumerate(steps):
    x = colx(i) + 10; w = COL_W - 20
    out.append(f'<rect x="{x}" y="{HEAD_Y}" width="{w}" height="{HEAD_H}" rx="27" fill="#1c1f24"/>')
    out.append(f'<circle cx="{x+27}" cy="{HEAD_Y+HEAD_H/2}" r="15" fill="#ffffff"/>')
    out.append(f'<text x="{x+27}" y="{HEAD_Y+HEAD_H/2+5}" text-anchor="middle" font-size="14" font-weight="700" fill="#1c1f24">{i}</text>')
    out.append(f'<text x="{x+52}" y="{HEAD_Y+HEAD_H/2+5}" font-size="15" font-weight="600" fill="#ffffff">{e(s)}</text>')
    if i < len(steps) - 1:
        out.append(f'<line x1="{x+w+1}" y1="{HEAD_Y+HEAD_H/2}" x2="{x+w+19}" y2="{HEAD_Y+HEAD_H/2}" stroke="#646a75" stroke-width="2" marker-end="url(#arr)"/>')

y = LANE_Y0
lane_pos = {}
for li, (name, h) in enumerate(lanes):
    lane_pos[name] = (y, h)
    out.append(f'<rect x="{M}" y="{y}" width="{W-2*M}" height="{h}" rx="10" fill="{"#f7f8fa" if li % 2 == 0 else "#fbfbfc"}" stroke="#e3e6eb"/>')
    out.append(f'<text x="{M+16}" y="{y+h/2+6}" font-size="16" font-weight="700" fill="{LANE_LABEL_COLOR[name]}">{e(name)}</text>')
    for i, (kind, lines, tags) in enumerate(cells[name]):
        st = STY[kind]
        bx, by, bw, bh = colx(i) + 10, y + 12, COL_W - 20, h - 24
        dash = f' stroke-dasharray="{st["dash"]}"' if st["dash"] else ""
        out.append(f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="8" fill="{st["fill"]}" stroke="{st["stroke"]}" stroke-width="1.5"{dash}/>')
        ty = by + 24
        for ln in lines:
            out.append(f'<text x="{bx+12}" y="{ty}" font-size="13.5" font-weight="{st["weight"]}" fill="{st["text"]}">{e(ln)}</text>')
            ty += 19
        # Lay tags out left to right from the bottom, wrapping up a row when full.
        tx = bx + 10; tagy = by + bh - 28
        for t in tags:
            tw = 7.0 * len(t) + 14
            if tx > bx + 10 and tx + tw > bx + bw - 8:
                tx = bx + 10; tagy -= 26
            out.append(f'<rect x="{tx}" y="{tagy}" width="{tw}" height="20" rx="10" fill="#ffffff" stroke="#d97757"/>')
            out.append(f'<text x="{tx+7}" y="{tagy+14}" font-size="11.5" font-family="SFMono-Regular, Menlo, monospace" fill="#c15f3c">{e(t)}</text>')
            tx += tw + 6
    y += h + 10

# QA loop arrow around step 4 agent box
ay, ah = lane_pos["Agent"]
lx = colx(4) + COL_W - 10
out.append(f'<path d="M {lx} {ay+ah-40} C {lx+18} {ay+ah-40}, {lx+18} {ay+40}, {lx} {ay+40}" fill="none" stroke="#d97757" stroke-width="2" marker-end="url(#arrO)"/>')
out.append(f'<text x="{colx(4)+16}" y="{ay+ah+2}" font-size="11" fill="#c15f3c" font-style="italic">loops until QA passes and the PR is approved</text>')

# legend
ly = y + 14
items = [("gate", "Human gate: blocks progress until you act"), ("ask", "Human, only when the agent asks"),
         ("agent", "Agent work (never messages a person)"), ("board", "What the Corvid board shows")]
lx = M
for kind, label in items:
    st = STY[kind]
    dash = f' stroke-dasharray="{st["dash"]}"' if st["dash"] else ""
    out.append(f'<rect x="{lx}" y="{ly}" width="22" height="16" rx="4" fill="{st["fill"]}" stroke="{st["stroke"]}" stroke-width="1.5"{dash}/>')
    out.append(f'<text x="{lx+30}" y="{ly+13}" font-size="13" fill="#1c1f24">{e(label)}</text>')
    lx += 30 + 7.2 * len(label) + 34
out.append(f'<rect x="{lx}" y="{ly-1}" width="90" height="18" rx="9" fill="#ffffff" stroke="#d97757"/>')
out.append(f'<text x="{lx+8}" y="{ly+12}" font-size="11.5" font-family="SFMono-Regular, Menlo, monospace" fill="#c15f3c">skill-name</text>')
out.append(f'<text x="{lx+98}" y="{ly+13}" font-size="13" fill="#1c1f24">Skill the agent uses</text>')

# gaps
gy = ly + 44
out.append(f'<rect x="{M}" y="{gy}" width="{W-2*M}" height="104" rx="10" fill="#fff8f5" stroke="#f0c9b8"/>')
out.append(f'<text x="{M+16}" y="{gy+26}" font-size="15" font-weight="700" fill="#4a2414">Still manual, could be automated</text>')
gaps = ["PR and Linear status lines only update when you click Refresh.",
        "Cards don't move columns as work progresses, so high-contrast Needs you columns depend on you moving cards.",
        "Close-out is manual, even when the agent knows the PR is merged and the Linear issue is done."]
for k, g in enumerate(gaps):
    out.append(f'<circle cx="{M+22}" cy="{gy+46+k*20}" r="3" fill="#d97757"/>')
    out.append(f'<text x="{M+34}" y="{gy+51+k*20}" font-size="13.5" fill="#4a2414">{e(g)}</text>')
out.append('</svg>')
open(Path(__file__).with_name("workflow.svg"), "w").write("\n".join(out))
print(W, H)
