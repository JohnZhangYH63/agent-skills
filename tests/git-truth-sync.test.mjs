import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const script = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const snapshot = script('git-truth-sync/scripts/snapshot.mjs');
const classify = script('git-truth-sync/scripts/classify-dirty.mjs');
const verify = script('git-truth-sync/scripts/verify-against-snapshot.mjs');

function setupRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gts-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', join(dir, 'no-hooks'));

  const put = (rel, text) => {
    mkdirSync(join(repo, rel, '..'), { recursive: true });
    writeFileSync(join(repo, rel), text);
  };
  put(
    'AGENTS.md',
    [
      '---',
      'orchestrator_schema: 1',
      'remote: "truth"',
      'main_branch: "main"',
      'check_cmds: ["node -e \\"process.exit(0)\\""]',
      'redline_globs: ["AGENTS.md"]',
      'closed_lane_globs: []',
      'doc_managed: ["docs", "*.md"]',
      '---',
      '',
      '# Repo',
      '',
    ].join('\n'),
  );
  put('.gitignore', 'ignored.tmp\n');
  put('src/code.js', 'line1\nline2\nline3\nline4\nline5\n');
  put('docs/guide.md', 'v1\n');
  put('docs/note.md', 'note-v1\n');
  symlinkSync('guide.md', join(repo, 'docs/latest.md'));
  git('add', '.');
  git('commit', '-qm', 'initial');

  const remote = join(dir, 'remote.git');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', remote]);
  git('remote', 'add', 'truth', remote);
  git('push', '-q', 'truth', 'main');
  git('fetch', '-q', 'truth');

  const run = (file, ...args) => spawnSync(process.execPath, [file, ...args], { cwd: repo, encoding: 'utf8' });
  return { dir, repo, remote, git, put, run };
}

test('snapshot captures tracked + untracked without touching real index, and --verify detects post-snapshot changes', (t) => {
  const f = setupRepo(t);
  f.put('src/code.js', 'dirty-code\n');
  f.put('local-only.txt', 'precious wip\n');
  f.put('ignored.tmp', 'do not snapshot\n');

  const indexBefore = readFileSync(join(f.repo, '.git/index'));
  const snap = f.run(snapshot, '--name', 'snapshot/test-1');
  assert.equal(snap.status, 0, snap.stderr);
  const indexAfter = readFileSync(join(f.repo, '.git/index'));
  assert.deepEqual(indexAfter, indexBefore);

  assert.equal(f.git('show', 'snapshot/test-1:src/code.js'), 'dirty-code');
  assert.equal(f.git('show', 'snapshot/test-1:local-only.txt'), 'precious wip');
  assert.throws(() => f.git('show', 'snapshot/test-1:ignored.tmp'));

  assert.equal(f.run(snapshot, '--verify', 'snapshot/test-1').status, 0);
  f.put('local-only.txt', 'modified after snapshot\n');
  const changed = f.run(snapshot, '--verify', 'snapshot/test-1');
  assert.equal(changed.status, 1);
  assert.match(changed.stdout, /自快照后有变化/);
});

test('classify-dirty separates stale copies, genuine WIP, symlink targets and blocking untracked files, then verify-against-snapshot validates fast-forward', (t) => {
  const f = setupRepo(t);
  const startSha = f.git('rev-parse', 'HEAD');

  // 造一个提供副本的分支 copy-src,同时把远端 truth/main 推前一步(改 src/code.js 末尾与 docs/guide.md,新增 conflict.txt)
  f.git('checkout', '-q', '-b', 'copy-src');
  f.put('docs/guide.md', 'v2-from-copy\n');
  f.put('docs/copied-new.md', 'copied untracked\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'docs on copy-src');

  f.git('checkout', '-q', '-b', 'advance-remote', startSha);
  f.put('src/code.js', 'line1\nline2\nline3\nline4\nremote-line5\n');
  f.put('docs/guide.md', 'v2-from-remote\n');
  f.put('conflict.txt', 'from remote\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'remote advance');
  f.git('push', '-q', 'truth', 'advance-remote:main');
  f.git('fetch', '-q', 'truth');

  // 回到落后的 main,构造各种未提交状态(含被改向的符号链接 docs/latest.md → note.md)
  f.git('checkout', '-q', 'main');
  f.git('branch', '-D', 'advance-remote');
  f.put('src/code.js', 'wip-line1\nline2\nline3\nline4\nline5\n'); // code_tracked(与远端改不同行,可三方合并)
  f.put('docs/guide.md', 'v2-from-copy\n'); // doc_tracked_stale(== copy-src)
  f.put('docs/note.md', 'genuine-local-doc\n'); // doc_tracked_genuine
  rmSync(join(f.repo, 'docs/latest.md'));
  symlinkSync('note.md', join(f.repo, 'docs/latest.md')); // 120000 符号链接改动(按链接字符串而非目标内容核对)
  f.put('docs/copied-new.md', 'copied untracked\n'); // untracked_stale
  f.put('scratch.txt', 'my local scratch\n'); // untracked_genuine
  f.put('conflict.txt', 'blocks ff\n'); // blocking

  const clsPath = join(f.dir, 'classify.json');
  const clsRes = f.run(classify, '--target', 'truth/main', '--copy-ref', 'copy-src', '--out', clsPath);
  assert.equal(clsRes.status, 0, clsRes.stderr);
  const cls = JSON.parse(readFileSync(clsPath, 'utf8'));
  assert.deepEqual(cls.code_tracked, ['src/code.js']);
  assert.deepEqual(cls.doc_tracked_stale, ['docs/guide.md']);
  assert.deepEqual(cls.doc_tracked_genuine.sort(), ['docs/latest.md', 'docs/note.md']);
  assert.deepEqual(cls.untracked_stale, ['docs/copied-new.md']);
  assert.deepEqual(cls.untracked_genuine.sort(), ['conflict.txt', 'scratch.txt']);
  assert.deepEqual(cls.blocking, ['conflict.txt']);

  // 人工移走 blocking 后,重跑快照 + 分类 + 快进 + 三方合并放回 + verify-against-snapshot
  rmSync(join(f.repo, 'conflict.txt'));
  assert.equal(f.run(snapshot, '--name', 'snapshot/ff-test').status, 0);
  assert.equal(f.run(classify, '--target', 'truth/main', '--copy-ref', 'copy-src', '--out', clsPath).status, 0);
  assert.equal(f.run(snapshot, '--verify', 'snapshot/ff-test').status, 0);

  const patch = execFileSync('git', ['diff', '--binary', 'HEAD', '--', 'src/code.js'], { cwd: f.repo });
  const genuineDoc = readFileSync(join(f.repo, 'docs/note.md'));
  f.git('checkout', 'HEAD', '--', 'src/code.js', 'docs/guide.md', 'docs/latest.md', 'docs/note.md');
  rmSync(join(f.repo, 'docs/copied-new.md'));
  f.git('merge', '--ff-only', 'truth/main');

  const patchFile = join(f.dir, 'wip.patch');
  writeFileSync(patchFile, patch);
  f.git('apply', '--3way', patchFile);
  f.git('reset', '-q');
  writeFileSync(join(f.repo, 'docs/note.md'), genuineDoc);
  rmSync(join(f.repo, 'docs/latest.md'));
  symlinkSync('note.md', join(f.repo, 'docs/latest.md'));

  const verOk = f.run(verify, '--snapshot', 'snapshot/ff-test', '--classify', clsPath);
  assert.equal(verOk.status, 0, verOk.stdout + verOk.stderr);
  assert.match(verOk.stdout, /一致 3 \| 三方合并待人工看 1 \| 不一致 0 \| 缺失 0/);
  assert.match(verOk.stdout, /merged\s+src\/code\.js/);
  assert.equal(readFileSync(join(f.repo, 'docs/guide.md'), 'utf8'), 'v2-from-remote\n');

  // 若真 WIP 丢失或被改坏,verify-against-snapshot 必须以退出码 1 报错
  rmSync(join(f.repo, 'scratch.txt'));
  const verMissing = f.run(verify, '--snapshot', 'snapshot/ff-test', '--classify', clsPath);
  assert.equal(verMissing.status, 1);
  assert.match(verMissing.stdout, /missing\s+scratch\.txt/);
});
