const { test } = require('node:test');
const assert = require('node:assert');
const { parseGitStatus } = require('../lib/git.js');

test('normal branch, clean, no upstream', () => {
  const out = '# branch.oid abc1234def\n# branch.head main\n';
  assert.deepStrictEqual(parseGitStatus(out), { branch: 'main', dirty: false, ahead: null, behind: null });
});

test('ahead/behind from branch.ab', () => {
  const out = '# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n';
  const s = parseGitStatus(out);
  assert.strictEqual(s.ahead, 2);
  assert.strictEqual(s.behind, 1);
});

test('dirty when a change/untracked line is present', () => {
  const out = '# branch.head main\n1 .M N... 100644 100644 100644 a a file.js\n';
  assert.strictEqual(parseGitStatus(out).dirty, true);
  const out2 = '# branch.head main\n? untracked.txt\n';
  assert.strictEqual(parseGitStatus(out2).dirty, true);
});

test('detached HEAD → short oid as branch', () => {
  const out = '# branch.oid 1a2b3c4d5e6f\n# branch.head (detached)\n';
  assert.strictEqual(parseGitStatus(out).branch, '1a2b3c4');
});

test('empty output → null branch, not dirty', () => {
  assert.deepStrictEqual(parseGitStatus(''), { branch: null, dirty: false, ahead: null, behind: null });
});

test('upstream tracked but no branch.ab line → ahead/behind null', () => {
  const out = '# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n';
  const s = parseGitStatus(out);
  assert.strictEqual(s.ahead, null);
  assert.strictEqual(s.behind, null);
});

test('branch.ab +0 -0 → ahead/behind are 0 (in sync), distinct from null', () => {
  const out = '# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n';
  const s = parseGitStatus(out);
  assert.strictEqual(s.ahead, 0);
  assert.strictEqual(s.behind, 0);
});
