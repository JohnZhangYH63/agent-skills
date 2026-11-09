import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const audit = fileURLToPath(new URL('../git-truth-sync/scripts/worktree-audit.mjs', import.meta.url));
const classify = fileURLToPath(new URL('../git-truth-sync/scripts/classify-dirty.mjs', import.meta.url));
const whitelist = fileURLToPath(new URL('../task-package-orchestration/scripts/check-package-whitelist.mjs', import.meta.url));
const defaults = { remote: 'truth', mainBranch: 'main', managed: ['docs', '*.md'], redline: ['protected/**'] };

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'instruction-guards-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', join(dir, 'no-hooks'));
  writeFileSync(join(repo, 'README.md'), 'fixture\n');
  mkdirSync(join(repo, 'protected'));
  writeFileSync(join(repo, 'protected/data.txt'), 'before\n');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  const base = git('rev-parse', 'HEAD');
  const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8' });
  const config = (value = defaults, path = join(repo, '.docflow.json')) => writeFileSync(path, JSON.stringify(value));
  return { dir, repo, git, base, run, config };
}

test('missing configuration stops Git and whitelist operations', (t) => {
  const f = fixture(t);
  for (const [script, args] of [[audit, []], [classify, ['--target', 'HEAD']], [whitelist, ['--base', f.base, '--allow', '**']]]) {
    const result = f.run(script, ...args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /缺少配置/);
  }
  assert.equal(existsSync(join(f.repo, 'gts-classify.json')), false);
});

test('Git configuration must name its remote, branch and managed paths', (t) => {
  const f = fixture(t);
  for (const key of ['remote', 'mainBranch', 'managed']) {
    const cfg = { ...defaults };
    delete cfg[key];
    f.config(cfg);
    const result = f.run(audit);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(key));
  }
});

test('whitelist cannot silently drop redlines for absent or malformed fields', (t) => {
  const f = fixture(t);
  for (const redline of [undefined, null, 'protected/**', ['']]) {
    f.config({ ...defaults, redline });
    const result = f.run(whitelist, '--base', f.base, '--allow', '**');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /redline/);
  }
});

test('protected modifications fail even when the allow glob covers everything', (t) => {
  const f = fixture(t);
  const path = join(f.dir, 'explicit-config.json');
  f.config(defaults, path);
  writeFileSync(join(f.repo, 'protected/data.txt'), 'after\n');
  const args = ['--base', f.base, '--allow', '**', '--config', path];
  const denied = f.run(whitelist, ...args);
  assert.equal(denied.status, 1);
  assert.match(denied.stdout, /黑名单 protected\/\*\*/);
  assert.equal(f.run(whitelist, ...args, '--allow-redline').status, 0);
  f.config({ ...defaults, redline: [] }, path);
  assert.equal(f.run(whitelist, ...args).status, 0);
});

function localRemote(f) {
  const remote = join(f.dir, 'remote.git');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', remote]);
  f.git('remote', 'add', 'truth', remote);
  f.git('push', '-q', 'truth', 'main');
  f.git('fetch', '-q', 'truth');
  return remote;
}

test('default audit neither fetches nor changes refs, FETCH_HEAD or worktree indexes', (t) => {
  const f = fixture(t);
  f.config();
  const remote = localRemote(f);
  const wt = join(f.dir, 'side');
  f.git('worktree', 'add', '-q', '-b', 'side', wt);
  const oldRef = f.git('rev-parse', 'refs/remotes/truth/main');
  const fetchPath = join(f.repo, '.git/FETCH_HEAD');
  const oldFetch = readFileSync(fetchPath);
  const indexPath = join(f.repo, '.git/worktrees/side/index');
  const oldIndex = readFileSync(indexPath);
  f.git('commit', '--allow-empty', '-qm', 'remote advance');
  const latest = f.git('rev-parse', 'HEAD');
  // Push by path, so this checkout's named remote-tracking ref stays at the old commit.
  f.git('push', '-q', remote, 'main');
  assert.equal(f.git('rev-parse', 'refs/remotes/truth/main'), oldRef);
  const result = f.run(audit);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /本地缓存/);
  assert.equal(f.git('rev-parse', 'refs/remotes/truth/main'), oldRef);
  assert.deepEqual(readFileSync(fetchPath), oldFetch);
  assert.deepEqual(readFileSync(indexPath), oldIndex);
  assert.equal(f.run(audit, '--fetch').status, 0);
  assert.equal(f.git('rev-parse', 'refs/remotes/truth/main'), latest);
});

test('failed explicit fetch stops before a requested worktree removal', (t) => {
  const f = fixture(t);
  f.config();
  localRemote(f);
  const wt = join(f.dir, 'side');
  f.git('worktree', 'add', '-q', '-b', 'side', wt);
  f.git('remote', 'set-url', 'truth', join(f.dir, 'missing.git'));
  const result = f.run(audit, '--fetch', '--remove-safe');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /刷新远端.*失败/);
  assert.equal(existsSync(wt), true);
});

test('missing configured reference does not fall back to origin/main', (t) => {
  const f = fixture(t);
  f.config();
  f.git('update-ref', 'refs/remotes/origin/main', f.base);
  const result = f.run(audit);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /truth\/main/);
});

test('cleanup preserves dirty worktrees and the active checkout', (t) => {
  const f = fixture(t);
  f.config();
  localRemote(f);
  const wt = join(f.dir, 'side');
  f.git('worktree', 'add', '-q', '-b', 'side', wt);
  writeFileSync(join(wt, 'uncommitted.txt'), 'keep\n');
  const result = f.run(audit, '--remove-safe');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(wt, 'uncommitted.txt'), 'utf8'), 'keep\n');
  assert.equal(existsSync(f.repo), true);
});
