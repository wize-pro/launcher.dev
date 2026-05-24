#!/usr/bin/env node
// Generates ROADMAP.md from the repository's GitHub issues + milestones.
// Source of truth = Issues (labels, state) grouped by Milestone.
// Run locally with `npm run roadmap` (requires the `gh` CLI authenticated),
// or automatically via .github/workflows/roadmap.yml (uses the Actions token).
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const repo = process.env.GITHUB_REPOSITORY || 'wize-pro/launcher.dev';
const boardUrl = 'https://github.com/users/wize-pro/projects/1';

// Human-friendly headings for known milestones (others fall back to their title).
const heading = {
  'v0.2.0': 'v0.2.0 — Next iteration',
  'v1.0.0': 'v1.0.0 — Stabilization',
};

const raw = execSync(
  `gh issue list --repo ${repo} --state all --limit 500 --json number,title,state,labels,milestone`,
  { encoding: 'utf8' },
);
const issues = JSON.parse(raw);

const groups = new Map(); // milestone title -> issues[]
const unscheduled = [];
for (const i of issues) {
  const m = i.milestone && i.milestone.title;
  if (m) {
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(i);
  } else {
    unscheduled.push(i);
  }
}

// Version-aware sort: "vX.Y.Z" numerically, non-version titles after (alphabetical).
function cmpMilestone(a, b) {
  const pa = a.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  const pb = b.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (pa && pb) {
    for (let k = 1; k <= 3; k++) {
      const d = Number(pa[k]) - Number(pb[k]);
      if (d) return d;
    }
    return 0;
  }
  if (pa) return -1;
  if (pb) return 1;
  return a.localeCompare(b);
}

const byNumber = (a, b) => a.number - b.number;
const fmt = (i) => {
  const labels = (i.labels || []).map((l) => l.name).join(', ');
  const box = i.state === 'CLOSED' ? 'x' : ' ';
  return `- [${box}] #${i.number} ${i.title}${labels ? ` — _${labels}_` : ''}`;
};

let md = '# Roadmap\n\n';
md += '<!-- AUTO-GENERATED from GitHub issues + milestones by scripts/gen-roadmap.mjs. Do not edit by hand. -->\n\n';
md += "This roadmap is generated from the repository's GitHub issues and milestones.\n";
md += `Live board: <${boardUrl}>\n\n`;
md += '> Versioning follows SemVer; while in 0.x, minor versions may include breaking changes.\n\n';

for (const m of [...groups.keys()].sort(cmpMilestone)) {
  const list = groups.get(m).sort(byNumber);
  md += `## ${heading[m] || m}\n\n${list.map(fmt).join('\n')}\n\n`;
}
if (unscheduled.length) {
  md += `## Unscheduled / backlog\n\n${unscheduled.sort(byNumber).map(fmt).join('\n')}\n`;
}

const changed = !existsSync('ROADMAP.md') || readFileSync('ROADMAP.md', 'utf8') !== md;
writeFileSync('ROADMAP.md', md);
console.log(changed ? 'ROADMAP.md updated.' : 'ROADMAP.md already up to date.');
