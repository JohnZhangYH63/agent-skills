import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const script = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const docInit = script('project-doc-flow/scripts/docflow-init.mjs');
const docCheck = script('project-doc-flow/scripts/check-doc-flow.mjs');
const docArchive = script('project-doc-flow/scripts/doc-cold-archive.mjs');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function makeRepo(t, frontmatter = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'doc-flow-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', join(dir, 'no-hooks'));

  const cfg = {
    orchestrator_schema: 1,
    remote: 'truth',
    main_branch: 'main',
    check_cmds: ['node -e "process.exit(0)"'],
    redline_globs: ['AGENTS.md'],
    closed_lane_globs: [],
    doc_managed: ['docs', '*.md'],
    ...frontmatter,
  };
  const fmLines = Object.entries(cfg).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  const put = (rel, text) => {
    mkdirSync(join(repo, rel, '..'), { recursive: true });
    writeFileSync(join(repo, rel), text);
  };
  put('AGENTS.md', `---\n${fmLines.join('\n')}\n---\n\n# Demo\n\n编排者读 task-package-orchestration。\n`);
  put('src/app.js', 'export const x = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const run = (file, ...args) => spawnSync(process.execPath, [file, ...args], { cwd: repo, encoding: 'utf8' });
  return { dir, repo, git, put, run };
}

test('docflow-init scaffolds skeleton without overwriting and passes check-doc-flow', (t) => {
  const f = makeRepo(t, { doc_plan: 'docs/work/后续工程总计划-*.md' });
  f.put('docs/索引.md', '# 自定义索引\n');

  const dry = f.run(docInit, '--name', 'DemoProj', '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(existsSync(join(f.repo, 'docs/总路线图.md')), false);

  const init = f.run(docInit, '--name', 'DemoProj');
  assert.equal(init.status, 0, init.stderr);
  assert.equal(readFileSync(join(f.repo, 'docs/索引.md'), 'utf8'), '# 自定义索引\n');
  assert.equal(existsSync(join(f.repo, 'docs/总路线图.md')), true);

  f.git('add', '.');
  f.git('commit', '-qm', 'scaffold docs');
  const check = f.run(docCheck);
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test('doc-cold-archive rewrites bidirectional links, verifies sha256, and leaves uncommitted WIP unstaged', (t) => {
  const f = makeRepo(t);
  f.run(docInit, '--name', 'DemoProj');
  f.put(
    'docs/work/PKG1-交付-20260120.md',
    [
      '# PKG1 交付',
      '',
      '参见 [总路线图](../总路线图.md#阶段) 与同批 [审核记录](PKG1-审核-20260121.md#结论)。',
      '代码块内不改链：',
      '```markdown',
      '示例 [不动](../总路线图.md)',
      '```',
      '',
    ].join('\n'),
  );
  f.put('docs/work/PKG1-审核-20260121.md', '# PKG1 审核\n\n## 结论\n\n通过，回看 [交付](PKG1-交付-20260120.md)。\n');
  f.put('docs/完成台账.md', '# 台账\n\n- 见 [PKG1 交付](work/PKG1-交付-20260120.md#top) 与 [PKG1 审核](work/PKG1-审核-20260121.md)\n');
  f.put('docs/work/WIP-草稿.md', '# 草稿\n\n引用 [PKG1 交付](PKG1-交付-20260120.md)\n');
  f.git('add', 'docs');
  f.git('reset', '-q', 'docs/work/WIP-草稿.md');
  f.git('commit', '-qm', 'add package process docs');
  const pkgCommit = f.git('rev-parse', 'HEAD');

  const specFile = join(f.dir, 'archive-spec.json');
  writeFileSync(
    specFile,
    JSON.stringify({
      date: '2026-01-31',
      scope: '1月关账批次',
      groups: [
        {
          files: ['PKG1-交付-20260120.md', 'PKG1-审核-20260121.md'],
          scope: 'PKG1 完成',
          triggers: ['PKG1', '登录'],
          open_items: '无',
        },
      ],
    }),
  );

  // 有未提交改动的过程稿拒绝转冷
  f.put('docs/work/PKG1-审核-20260121.md', '# 脏改动\n');
  assert.equal(f.run(docArchive, specFile).status, 1);
  f.git('checkout', 'HEAD', '--', 'docs/work/PKG1-审核-20260121.md');

  // dry-run 不落盘
  assert.equal(f.run(docArchive, specFile, '--dry-run').status, 0);
  assert.equal(existsSync(join(f.repo, 'docs/work/archive/2026-01-31')), false);

  // 正式转冷
  const arch = f.run(docArchive, specFile);
  assert.equal(arch.status, 0, arch.stdout + arch.stderr);

  const coldDelivery = readFileSync(join(f.repo, 'docs/work/archive/2026-01-31/PKG1-交付-20260120.md'), 'utf8');
  assert.match(coldDelivery, /\[总路线图\]\(\.\.\/\.\.\/\.\.\/总路线图\.md#阶段\)/);
  assert.match(coldDelivery, /\[审核记录\]\(PKG1-审核-20260121\.md#结论\)/);
  assert.match(coldDelivery, /示例 \[不动\]\(\.\.\/总路线图\.md\)/);

  const ledger = readFileSync(join(f.repo, 'docs/完成台账.md'), 'utf8');
  assert.match(ledger, /work\/archive\/2026-01-31\/PKG1-交付-20260120\.md#top/);

  // 未跟踪 WIP 文档的入链也被更新,但绝不被 git add 暂存
  const wip = readFileSync(join(f.repo, 'docs/work/WIP-草稿.md'), 'utf8');
  assert.match(wip, /archive\/2026-01-31\/PKG1-交付-20260120\.md/);
  const staged = f.git('diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean);
  assert.equal(staged.includes('docs/work/WIP-草稿.md'), false);
  assert.equal(staged.includes('docs/完成台账.md'), true);

  // 核对 manifest.json 的 source_commit / source_sha256 / cold_sha256
  const manifest = JSON.parse(readFileSync(join(f.repo, 'docs/work/archive/2026-01-31/manifest.json'), 'utf8'));
  assert.equal(manifest.archive_count, 2);
  for (const row of manifest.rows) {
    assert.equal(row.source_commit, pkgCommit);
    const origBytes = execFileSync('git', ['show', `${row.source_commit}:${row.old_path}`], { cwd: f.repo });
    assert.equal(row.source_sha256, sha256(origBytes));
    assert.equal(row.cold_sha256, sha256(readFileSync(join(f.repo, row.cold_path))));
  }

  rmSync(join(f.repo, 'docs/work/WIP-草稿.md'));
  f.git('commit', '-qm', 'cold archive 2026-01-31');
  const check = f.run(docCheck);
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test('check-doc-flow catches dirty root *.md and does not misreport code changes when doc_managed is ["*.md"]', (t) => {
  const f = makeRepo(t, {
    doc_managed: ['*.md'],
    doc_roadmap: 'ROADMAP.md',
    doc_plan: 'PLAN.md',
    doc_decisions: 'DECISIONS.md',
    doc_ledger: 'LEDGER.md',
    doc_index: 'INDEX.md',
    doc_hot_dir: 'hot',
    doc_archive_dir: 'hot/archive',
  });
  f.put('ROADMAP.md', '# Roadmap\n');
  f.put('PLAN.md', '# Plan\n\n**唯一下一包**: 无\n');
  f.put('DECISIONS.md', '# Decisions\n');
  f.put('LEDGER.md', '# Ledger\n');
  f.put('INDEX.md', '# Index\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'root docs');

  const remote = join(f.dir, 'remote.git');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', remote]);
  f.git('remote', 'add', 'truth', remote);
  f.git('push', '-q', 'truth', 'main');
  f.git('fetch', '-q', 'truth');

  // 只改业务代码 src/app.js:不应误报“未提交文档改动”
  f.put('src/app.js', 'export const x = 2;\n');
  const codeOnly = JSON.parse(f.run(docCheck, '--json').stdout);
  assert.deepEqual(codeOnly.warnings, []);
  assert.deepEqual(codeOnly.errors, []);

  // 改根目录 PLAN.md 未提交:应准确检出,--strict-sync 升为 ERROR
  f.put('PLAN.md', '# Plan\n\n**唯一下一包**: PKG-9\n');
  const dirtyDoc = JSON.parse(f.run(docCheck, '--json').stdout);
  assert.match(dirtyDoc.warnings.join('\n'), /有 1 条未提交文档改动/);
  assert.equal(f.run(docCheck, '--strict-sync').status, 1);
});
