const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const activityCache = new Map(); // dir -> { value, expires }
const ACTIVITY_TTL = 15000;      // 15 s

const statusCache = new Map();
const STATUS_TTL = 15000;

function parseGitStatus(stdout) {
  const lines = (stdout || '').split('\n');
  let branch = null, oid = null, dirty = false, ahead = null, behind = null;
  for (const line of lines) {
    if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length).trim();
    else if (line.startsWith('# branch.oid ')) oid = line.slice('# branch.oid '.length).trim();
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/# branch\.ab \+(\d+) -(\d+)/);
      if (m) { ahead = parseInt(m[1], 10); behind = parseInt(m[2], 10); }
    } else if (line && !line.startsWith('#')) {
      dirty = true;
    }
  }
  if (branch === '(detached)') branch = oid ? oid.slice(0, 7) : null;
  return { branch, dirty, ahead, behind };
}

function getGitStatus(dir) {
  const cached = statusCache.get(dir);
  if (cached && cached.expires > Date.now()) return cached.value;
  let value = null;
  try {
    const r = spawnSync('git', ['-C', dir, 'status', '--porcelain=v2', '--branch'], { encoding: 'utf8', timeout: 3000 });
    if (r.status === 0 && r.stdout) value = parseGitStatus(r.stdout);
  } catch {}
  statusCache.set(dir, { value, expires: Date.now() + STATUS_TTL });
  return value;
}

// Returns the timestamp (ms) of the last activity on the project.
// Priority: latest git commit > max mtime of top-level files.
function getLastActivity(dir, hasGit, { ignoreDirs }) {
  const cached = activityCache.get(dir);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = computeLastActivity(dir, hasGit, { ignoreDirs });
  activityCache.set(dir, { value, expires: Date.now() + ACTIVITY_TTL });
  return value;
}

function computeLastActivity(dir, hasGit, { ignoreDirs }) {
  if (hasGit) {
    try {
      const r = spawnSync('git', ['-C', dir, 'log', '-1', '--format=%ct', 'HEAD'], {
        encoding: 'utf8', timeout: 3000,
      });
      const ts = parseInt((r.stdout || '').trim(), 10);
      if (ts > 0) return { ts: ts * 1000, source: 'git' };
    } catch {}
  }

  // Fallback: max mtime of direct entries (excluding ignoreDirs)
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let max = 0;
    for (const e of entries) {
      if (ignoreDirs.includes(e.name) || e.name.startsWith('.')) continue;
      try {
        const m = fs.statSync(path.join(dir, e.name)).mtimeMs;
        if (m > max) max = m;
      } catch {}
    }
    if (max > 0) return { ts: max, source: 'fs' };
  } catch {}

  return { ts: null, source: null };
}

// Converts a git remote URL (SSH or HTTPS) into a navigable web URL
function remoteToWebUrl(remote, provider) {
  if (!remote) return null;

  // Already an HTTPS URL → strip the trailing .git
  if (remote.startsWith('https://') || remote.startsWith('http://')) {
    return remote.replace(/\.git$/, '');
  }

  // Azure SSH: git@ssh.dev.azure.com:v3/org/project/repo
  if (provider === 'azure' && remote.startsWith('git@ssh.dev.azure.com')) {
    const m = remote.match(/git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/(.+)/);
    if (m) return `https://dev.azure.com/${m[1]}/${m[2]}/_git/${m[3].replace(/\.git$/, '')}`;
  }

  // Standard SSH: git@host:user/repo.git  or  git@host:org/project/repo.git
  const sshMatch = remote.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const [, host, repoPath] = sshMatch;
    return `https://${host}/${repoPath}`;
  }

  // SCP-like without git@: host:path
  const scpMatch = remote.match(/^([a-zA-Z0-9._-]+):(.+?)(?:\.git)?$/);
  if (scpMatch) return null; // likely a local path, not navigable

  return null;
}

function detectGit(dir) {
  const gitDir = path.join(dir, '.git');
  if (!fs.existsSync(gitDir)) return { hasGit: false };

  // Read remote origin URL from .git/config
  let remote = null;
  try {
    const cfg = fs.readFileSync(path.join(gitDir, 'config'), 'utf8');
    const m = cfg.match(/\[remote\s+"origin"\][^\[]*\burl\s*=\s*(.+)/);
    if (m) remote = m[1].trim();
  } catch {}

  if (!remote) return { hasGit: true, provider: 'local', remote: null, url: null };

  // Identify provider from URL
  let provider = 'git';
  const r = remote.toLowerCase();
  if (r.includes('github.com'))                                             provider = 'github';
  else if (r.includes('gitlab.com'))                                        provider = 'gitlab';
  else if (r.includes('dev.azure.com') || r.includes('visualstudio.com'))  provider = 'azure';
  else if (r.includes('bitbucket.org'))                                     provider = 'bitbucket';
  else if (r.includes('gitlab'))                                            provider = 'gitlab-self';

  // Convert raw remote (SSH or HTTPS) to a clickable web URL
  const url = remoteToWebUrl(remote, provider);

  return { hasGit: true, provider, remote, url };
}

module.exports = { detectGit, remoteToWebUrl, getLastActivity, getGitStatus, parseGitStatus };
