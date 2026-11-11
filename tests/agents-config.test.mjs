import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseFrontmatter, renderFrontmatter, ConfigError } from '../_lib/agents-config.mjs';

const script = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const whitelist = script('task-package-orchestration/scripts/check-package-whitelist.mjs');
const lane = script('task-package-orchestration/scripts/lane.mjs');
const disjoint = script('task-package-orchestration/scripts/check-disjoint.mjs');
const gate = script('task-package-orchestration/scripts/gate-run.mjs');
const doctor = script('task-package-orchestration/scripts/doctor.mjs');
const audit = script('git-truth-sync/scripts/worktree-audit.mjs');
const docCheck = script('project-doc-flow/scripts/check-doc-flow.mjs');

const OK = 'node -e "process.exit(0)"';
const FAIL = 'node -e "process.exit(3)"';
// 仓库根出现 flag 文件后才失败:用来模拟「基线时绿、之后变红」
const FLAGGED = `node -e "process.exit(require('fs').existsSync('flag')?4:0)"`;
const agents = (over = {}) => {
  const v = {
    orchestrator_schema: 1,
    remote: 'truth',
    main_branch: 'main',
    check_cmds: [OK],
    redline_globs: ['protected/**', 'AGENTS.md'],
    closed_lane_globs: ['db/migrations/**'],
    wide_lane_globs: ['package.json'],
    doc_managed: ['docs', '*.md'],
    ...over,
  };
  const lines = Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${k}: ${JSON.stringify(x)}`);
  return `---\n${lines.join('\n')}\n---\n\n# fixture\n\n编排者读全局 skill task-package-orchestration。\n`;
};

function fixture(t, agentsText = agents()) {
  const dir = mkdtempSync(join(tmpdir(), 'agents-config-'));
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
  put('README.md', 'fixture\n');
  put('package.json', '{}\n');
  put('protected/data.txt', 'before\n');
  put('db/migrations/0001.sql', '-- one\n');
  put('src/a.js', '1\n');
  put('src/b.js', '1\n');
  if (agentsText !== null) put('AGENTS.md', agentsText);
  git('add', '.');
  git('commit', '-qm', 'fixture');
  const base = git('rev-parse', 'HEAD');
  const run = (file, ...args) => spawnSync(process.execPath, [file, ...args], { cwd: repo, encoding: 'utf8' });
  return { dir, repo, git, base, run, put };
}

test('frontmatter parses JSON-literal values, multi-line arrays, Prettier output and YAML lists', () => {
  const text = [
    '---',
    '# 注释',
    'orchestrator_schema: 1',
    "remote: 'gitea'",
    'main_branch:',
    "  'main'",
    'redline_globs:',
    '  [',
    "    'a/**',",
    '    "app/api/orders/[id]/route.ts",',
    '  ]',
    'check_cmds:',
    '  - "pnpm check:docs"',
    "  - 'pnpm test'",
    'doc_hot_limit: 20',
    '---',
    '',
    '# 正文',
  ].join('\n');
  const { values, bodyLines } = parseFrontmatter(text);
  assert.deepEqual(values, {
    schema: 1,
    remote: 'gitea',
    mainBranch: 'main',
    redline: ['a/**', 'app/api/orders/[id]/route.ts'],
    checkCmds: ['pnpm check:docs', 'pnpm test'],
    hotProcessLimit: 20,
  });
  assert.equal(bodyLines.join('\n').trim(), '# 正文');
  assert.equal(parseFrontmatter('# 没有 frontmatter\n'), null);
  assert.equal(parseFrontmatter('---\ntitle: "别人的 frontmatter"\n---\n'), null);
});

test('frontmatter rejects bare words, unknown keys, wrong types and newer schemas with line numbers', () => {
  const bad = (lines, pattern) =>
    assert.throws(() => parseFrontmatter(['---', 'orchestrator_schema: 1', ...lines, '---'].join('\n')), (e) => e instanceof ConfigError && pattern.test(e.message));
  bad(['remote: origin'], /第 3 行 remote.*JSON 字面量/);
  bad(['redline: ["x/**"]'], /第 3 行.*未知字段 redline/);
  bad(['redline_globs: "x/**"'], /第 3 行 redline_globs.*字符串数组/);
  bad(['check_cmds: ["a"] # 注释'], /第 3 行 check_cmds/);
  bad(['remote: "a"', 'remote: "b"'], /第 4 行.*重复/);
  assert.throws(() => parseFrontmatter('---\norchestrator_schema: 99\n---\n'), /只支持到/);
});

test('rendered frontmatter round-trips through the parser', () => {
  const values = { schema: 1, remote: 'gitea', mainBranch: 'main', checkCmds: ['pnpm test'], redline: ['a/**'], closedLane: Array.from({ length: 9 }, (_, i) => `very/long/path/number-${i}/**`) };
  assert.deepEqual(parseFrontmatter(`${renderFrontmatter(values, { remote: ['依据:x'] })}\n\n# body\n`).values, values);
});

test('whitelist reads redlines and lanes from AGENTS.md frontmatter', (t) => {
  const f = fixture(t);
  f.put('src/a.js', '2\n');
  f.put('db/migrations/0002.sql', '-- two\n');
  const args = ['--base', f.base, '--allow', '**'];
  const open = f.run(whitelist, ...args);
  assert.equal(open.status, 0, open.stderr);
  assert.match(open.stdout, /db\/migrations\/0002\.sql.*封死泳道 ← db\/migrations\/\*\*/);
  assert.match(open.stdout, /需 owner 对本次改动逐次明确授权/);
  assert.equal(f.run(whitelist, ...args, '--max-lane', 'wide').status, 1);
  assert.equal(f.run(whitelist, ...args, '--max-lane', 'closed').status, 0);

  f.put('protected/data.txt', 'after\n');
  const denied = f.run(whitelist, ...args);
  assert.equal(denied.status, 1);
  assert.match(denied.stdout, /黑名单 protected\/\*\*/);
  assert.equal(f.run(whitelist, ...args, '--allow-redline', 'protected/**').status, 0);
  assert.equal(f.run(whitelist, ...args, '--allow-redline', 'nope/**').status, 2);
  f.put('AGENTS.md', `${readFileSync(join(f.repo, 'AGENTS.md'), 'utf8')}\n改规则\n`);
  const self = f.run(whitelist, ...args, '--allow-redline', 'protected/**');
  assert.equal(self.status, 1);
  assert.match(self.stdout, /AGENTS\.md {2}\(黑名单 AGENTS\.md\)/);
});

test('frontmatter wins over a leftover .docflow.json and says so', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, '.docflow.json'), JSON.stringify({ remote: 'x', mainBranch: 'x', managed: ['docs'], redline: [] }));
  f.put('protected/data.txt', 'after\n');
  const result = f.run(whitelist, '--base', f.base, '--allow', '**', '--deny', '.docflow.json');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /黑名单 protected\/\*\*/);
  assert.match(result.stderr, /并存/);
});

test('a broken frontmatter stops scripts instead of falling back', (t) => {
  const f = fixture(t, agents().replace('remote: "truth"', 'remote: truth'));
  writeFileSync(join(f.repo, '.docflow.json'), JSON.stringify({ remote: 'x', mainBranch: 'x', managed: ['docs'], redline: [] }));
  const result = f.run(whitelist, '--base', f.base, '--allow', '**');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /JSON 字面量/);
});

test('lane predicts the lane of a whitelist before dispatch', (t) => {
  const f = fixture(t);
  const contained = f.run(lane, '--allow', 'src/**', '--max-lane', 'contained');
  assert.equal(contained.status, 0, contained.stderr);
  assert.match(contained.stdout, /泳道 = 局部可逆/);
  const closed = f.run(lane, '--allow', 'db/**', '--max-lane', 'wide');
  assert.equal(closed.status, 1);
  assert.match(closed.stdout, /封死泳道\(1\)/);
  const maybe = f.run(lane, '--allow', 'db/migrations/new/**');
  assert.match(maybe.stdout, /可能触及 封死泳道/);
  const wide = JSON.parse(f.run(lane, '--allow', '*.json', '--json').stdout);
  assert.equal(wide.lane, 'wide');
  f.put('db/migrations/0002.sql', '-- two\n');
  assert.equal(JSON.parse(f.run(lane, '--base', f.base, '--json').stdout).lane, 'closed');
});

test('parallel packages must not share files', (t) => {
  const f = fixture(t);
  const file = (name, text) => {
    const p = join(f.dir, name);
    writeFileSync(p, text);
    return p;
  };
  const a = file('a.txt', '# 包 A\nsrc/a.js\n');
  const overlap = f.run(disjoint, '--pkg', `A=${a}`, '--pkg', `B=${file('b.txt', 'src/**\n')}`);
  assert.equal(overlap.status, 1);
  assert.match(overlap.stdout, /src\/a\.js {2}\(A \+ B\)/);
  const carved = f.run(disjoint, '--pkg', `A=${a}`, '--pkg', `B=${file('b2.txt', 'src/**\n!src/a.js\n')}`);
  assert.equal(carved.status, 0, carved.stdout);
  assert.match(carved.stdout, /WARN {2}前缀相交/);
  assert.equal(f.run(disjoint, '--pkg', `A=${a}`).status, 2);
});

test('gate-run records each command and separates new reds from baseline reds', (t) => {
  const f = fixture(t, agents({ check_cmds: [FLAGGED, FAIL] }));
  const out = join(f.dir, 'gate-base');
  const first = f.run(gate, '--out', out);
  assert.equal(first.status, 1);
  const record = JSON.parse(readFileSync(join(out, 'gate.json'), 'utf8'));
  assert.deepEqual(record.results.map((r) => [r.exit, r.status]), [[0, 'green'], [3, 'new-red']]);
  assert.equal(record.head, f.base);
  assert.equal(existsSync(record.results[1].log), true);
  const again = f.run(gate, '--out', join(f.dir, 'gate-head'), '--baseline', join(out, 'gate.json'));
  assert.equal(again.status, 3);
  assert.match(again.stdout, /基线红 1/);
  f.put('flag', 'x\n');
  const worse = f.run(gate, '--out', join(f.dir, 'gate-worse'), '--baseline', join(out, 'gate.json'));
  assert.equal(worse.status, 1);
  assert.match(worse.stdout, /新增红 1 \/ 基线红 1/);
  f.put('AGENTS.md', agents({ check_cmds: [] }));
  assert.equal(f.run(gate).status, 2);
});

test('doctor flags legacy config and scattered rules, and init migrates without loosening', (t) => {
  const f = fixture(t, '# 旧项目\n\n编排者读 task-package-orchestration。\n');
  f.git('remote', 'add', 'truth', join(f.dir, 'nowhere.git'));
  writeFileSync(join(f.repo, '.docflow.json'), JSON.stringify({ remote: 'truth', mainBranch: 'main', managed: ['docs', '*.md'], redline: ['protected/**'] }));
  f.put('CLAUDE.md', Array.from({ length: 12 }, (_, i) => `- 规则 ${i}`).join('\n'));
  f.put('.agents/skills/orch/SKILL.md', '审核三态 ACCEPT / REWORK_ONCE / ESCALATE\n');
  f.git('add', '.');
  const legacy = f.run(doctor);
  assert.equal(legacy.status, 1);
  assert.match(legacy.stdout, /ERROR 项目配置还在旧式 \.docflow\.json/);
  assert.match(legacy.stdout, /WARN {2}CLAUDE\.md 有 12 行/);
  assert.match(legacy.stdout, /编排协议副本/);

  const draft = f.run(doctor, '--init');
  assert.equal(draft.status, 0);
  assert.match(draft.stdout, /redline_globs: \["protected\/\*\*", "AGENTS\.md"\]/);
  assert.match(draft.stdout, /closed_lane_globs: \["db\/migrations\/\*\*"\]/);
  assert.equal(readFileSync(join(f.repo, 'AGENTS.md'), 'utf8').startsWith('# 旧项目'), true);

  assert.equal(f.run(doctor, '--init', '--write').status, 0);
  assert.match(readFileSync(join(f.repo, 'AGENTS.md'), 'utf8'), /^---\norchestrator_schema: 1\n[\s\S]*\n---\n\n# 旧项目/);
  assert.match(f.run(doctor).stdout, /ERROR \.docflow\.json 仍在/);
  rmSync(join(f.repo, '.docflow.json'));
  const clean = f.run(doctor);
  assert.equal(clean.status, 0, clean.stdout);
  assert.doesNotMatch(clean.stdout, /^ERROR/m);
  assert.equal(f.run(doctor, '--init').status, 2);
});

test('doctor suggests tightening when risky paths are unguarded', (t) => {
  const f = fixture(t, agents({ closed_lane_globs: [], redline_globs: ['gone/**'] }));
  const result = f.run(doctor);
  assert.match(result.stdout, /建议收紧:db\/migrations\/\*\*/);
  assert.match(result.stdout, /gone\/\*\* 没匹配到任何已跟踪文件/);
  assert.match(result.stdout, /ERROR remote "truth" 不在 git remote/);
});

test('git-truth-sync and doc-flow read the same frontmatter', (t) => {
  const f = fixture(t);
  const remote = join(f.dir, 'remote.git');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', remote]);
  f.git('remote', 'add', 'truth', remote);
  f.git('push', '-q', 'truth', 'main');
  f.git('fetch', '-q', 'truth');
  const audited = f.run(audit);
  assert.equal(audited.status, 0, audited.stderr);
  const noManaged = fixture(t, agents({ doc_managed: undefined }));
  const missing = noManaged.run(audit);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /doc_managed/);
  const docs = JSON.parse(f.run(docCheck, '--json').stdout);
  assert.equal(docs.info?.config ?? docs.config, 'AGENTS.md');
});

test('whitelist blocks git mv out of redline and rejects empty diffs by default', (t) => {
  const f = fixture(t);
  const empty = f.run(whitelist, '--base', f.base, '--allow', '**');
  assert.equal(empty.status, 1);
  assert.match(empty.stdout, /无任何文件改动/);
  assert.equal(f.run(whitelist, '--base', f.base, '--allow', '**', '--allow-empty').status, 0);

  f.git('mv', 'protected/data.txt', 'src/moved.txt');
  f.git('commit', '-qm', 'move protected');
  const moved = f.run(whitelist, '--base', f.base, '--allow', 'src/**');
  assert.equal(moved.status, 1);
  assert.match(moved.stdout, /protected\/data\.txt {2}\(黑名单 protected\/\*\*\)/);
});

test('lane and disjoint catch **/ segment globs on non-existent paths without false alarms on src/**', (t) => {
  const f = fixture(t, agents({ closed_lane_globs: ['**/billing/**', '**/Dockerfile*'] }));
  assert.equal(f.run(lane, '--allow', 'src/**', '--max-lane', 'contained').status, 0);
  const newBilling = f.run(lane, '--allow', 'app/new-feature/billing/**', '--max-lane', 'contained');
  assert.equal(newBilling.status, 1);
  assert.match(newBilling.stdout, /可能触及 封死泳道.*\*\*\/billing\/\*\*/);
  const newDocker = f.run(lane, '--allow', 'services/worker/Dockerfile.gpu', '--max-lane', 'contained');
  assert.equal(newDocker.status, 1);
  assert.match(newDocker.stdout, /可能触及 封死泳道.*\*\*\/Dockerfile\*/);

  const a = join(f.dir, 'globstar-a.txt');
  const b = join(f.dir, 'globstar-b.txt');
  writeFileSync(a, '**/*.test.ts\n');
  writeFileSync(b, 'tests/new/*.test.ts\n');
  const dj = f.run(disjoint, '--pkg', `A=${a}`, '--pkg', `B=${b}`);
  assert.equal(dj.status, 0);
  assert.match(dj.stdout, /WARN {2}前缀相交.*\*\*\/\*\.test\.ts.*tests\/new\/\*\.test\.ts/);
});

test('doctor flags short CLAUDE.md pointing to deleted repo-local .agents/skills', (t) => {
  const f = fixture(t);
  f.git('remote', 'add', 'truth', join(f.dir, 'nowhere.git'));
  f.git('update-ref', 'refs/remotes/truth/main', f.base);
  f.put('CLAUDE.md', '# Entry\n\n读 AGENTS.md；按角色读 .agents/skills/project-orchestrator/SKILL.md。\n');
  const res = f.run(doctor);
  assert.match(res.stdout, /WARN {2}CLAUDE\.md 仍引用仓内 \.agents\/skills\//);
});

test('doctor supports local-only repos and gitignored secret redlines without masking typos', (t) => {
  const f = fixture(
    t,
    agents({
      remote: 'local',
      redline_globs: ['AGENTS.md', '.env', 'secrets/**', 'typo-secret/**'],
    }),
  );
  f.put('.gitignore', '.env\nsecrets/\n');
  f.git('add', '.gitignore');
  f.git('commit', '-qm', 'ignore secrets');

  const res = f.run(doctor);
  assert.equal(res.status, 0, res.stdout);
  assert.doesNotMatch(res.stdout, /\.env 没匹配到/);
  assert.doesNotMatch(res.stdout, /secrets\/\*\* 没匹配到/);
  assert.match(res.stdout, /WARN {2}redline_globs 的 typo-secret\/\*\* 没匹配到任何已跟踪文件/);

  const audited = f.run(audit);
  assert.equal(audited.status, 0, audited.stderr);
  assert.match(audited.stdout, /纯本地仓，比较本地主分支/);

  // 一旦仓库有真实远端(哪怕真叫 local),remote: "local" 保留字在 doctor 与 audit 中一律硬报错拒绝
  f.git('remote', 'add', 'local', join(f.dir, 'some-remote.git'));
  const docWithRemote = f.run(doctor);
  assert.equal(docWithRemote.status, 1);
  assert.match(docWithRemote.stdout, /ERROR remote 填了 "local".*已有远端\(local\)/);
  const auditWithRemote = f.run(audit);
  assert.equal(auditWithRemote.status, 1);
  assert.match(auditWithRemote.stderr, /remote 填了 "local".*已有远端/);
});

test('docflow check ignores markdown links inside fenced code blocks', (t) => {
  const f = fixture(t);
  f.put('docs/总路线图.md', '# 总路线图\n');
  f.put('docs/work/后续工程总计划.md', '# 排期\n\n**唯一下一包**：无\n');
  f.put('docs/work/现行决策.md', '# 决策\n');
  f.put('docs/完成台账.md', '# 台账\n');
  f.put('docs/索引.md', '# 索引\n');
  f.put('docs/work/reports/log.md', '# 报告\n\n```text\n下一包: [BID](../tasks/nonexistent.md)\n```\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'add docs with fenced stdout');
  const res = f.run(docCheck);
  assert.equal(res.status, 0, res.stdout);
});

test('doctor prints deterministic cold-start snapshot, resolved wildcard routes and next-package line', (t) => {
  const f = fixture(
    t,
    agents({
      remote: 'local',
      doc_roadmap: 'docs/总路线图.md',
      doc_plan: 'docs/work/后续工程总计划-*.md',
      doc_decisions: 'docs/work/现行决策.md',
      doc_ledger: 'docs/完成台账.md',
    }),
  );
  f.put('docs/总路线图.md', '# 总路线图\n');
  f.put('docs/work/后续工程总计划-202611.md', '# 排期\n\n**唯一下一包**：PKG-42 接入冷启动快照\n');
  f.put('docs/work/现行决策.md', '# 决策\n');
  f.put('docs/完成台账.md', '# 台账\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'add routing docs');

  const res = f.run(doctor);
  assert.equal(res.status, 0, res.stdout);
  assert.match(res.stdout, /^现场: main@[0-9a-f]+ \| 纯本地仓 \| 已跟踪未提交 0 \| 附加 worktree 0$/m);
  assert.match(res.stdout, /^路由: .*排期=docs\/work\/后续工程总计划-202611\.md/m);
  assert.match(res.stdout, /^下一包: \*\*唯一下一包\*\*：PKG-42 接入冷启动快照$/m);

  // 两份排期页并存时 doctor 直接报 ERROR(与 check-doc-flow 口径一致)
  f.put('docs/work/后续工程总计划-202612.md', '# 第二份排期\n');
  const dup = f.run(doctor);
  assert.equal(dup.status, 1);
  assert.match(dup.stdout, /ERROR doc_plan .* 匹配到 2 份/);
});

test('install.sh links skills and global preferences across Claude, Codex and Gemini without overwriting diverging files', (t) => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'agent-skills-home-'));
  t.after(() => rmSync(fakeHome, { recursive: true, force: true }));
  const installSh = script('install.sh');
  const runInstall = () =>
    spawnSync('bash', [installSh], { env: { ...process.env, HOME: fakeHome }, encoding: 'utf8' });

  mkdirSync(join(fakeHome, '.codex'), { recursive: true });
  writeFileSync(join(fakeHome, '.codex/AGENTS.md'), 'custom user note\n');

  const first = runInstall();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(lstatSync(join(fakeHome, '.claude/CLAUDE.md')).isSymbolicLink(), true);
  assert.equal(lstatSync(join(fakeHome, '.gemini/GEMINI.md')).isSymbolicLink(), true);
  assert.equal(lstatSync(join(fakeHome, '.gemini/config/skills/task-package-orchestration')).isSymbolicLink(), true);
  assert.equal(lstatSync(join(fakeHome, '.codex/AGENTS.md')).isSymbolicLink(), false);
  assert.equal(readFileSync(join(fakeHome, '.codex/AGENTS.md'), 'utf8'), 'custom user note\n');
  assert.match(first.stdout, /跳过 .*\.codex\/AGENTS\.md:已有不同内容/);
});

test('doctor emits passive obsolescence probes without WARN/ERROR and scripts tolerate .claude/worktrees', (t) => {
  const withAgedConstraint =
    agents({ remote: 'local', doc_ledger: 'docs/完成台账.md' }) +
    '\n## 4. 切包约束\n\n- 2025-01-10 · 旧约束 · PKG-1 · 退场：满足后删\n';
  const f = fixture(t, withAgedConstraint);
  const rows = Array.from(
    { length: 10 },
    (_, i) => `| 2026-10-${String(10 + i).padStart(2, '0')} | PKG-${i} | abc | ACCEPT | ok | 无 | — |`,
  ).join('\n');
  f.put('docs/完成台账.md', `# 台账\n\n${rows}\n`);
  f.git('add', '.');
  f.git('commit', '-qm', 'seed ledger and aged constraint');
  const startBase = f.git('rev-parse', 'HEAD');

  const docRes = f.run(doctor);
  assert.equal(docRes.status, 0, docRes.stdout);
  assert.match(docRes.stdout, /过时探针: 台账最近 10 包连续首轮 ACCEPT/);
  assert.match(docRes.stdout, /过时探针: 超 90 天切包约束\(项目 1 \//);
  assert.match(docRes.stdout, /体检:0 ERROR \/ 0 WARN/);

  // 模拟 Claude 原生 .claude/worktrees/ 在仓内创建子 worktree,验证白名单不误报越界、audit 识别为 [Claude仓内]
  const cwt = join(f.repo, '.claude/worktrees/agent-1');
  f.git('worktree', 'add', '-q', '-b', 'claude-wt', cwt);
  f.put('src/a.js', '2\n');
  const wl = f.run(whitelist, '--base', startBase, '--allow', 'src/**');
  assert.equal(wl.status, 0, wl.stdout + wl.stderr);
  const aud = f.run(audit);
  assert.equal(aud.status, 0, aud.stderr);
  assert.match(aud.stdout, /\[Claude仓内\]/);
  assert.doesNotMatch(aud.stdout, /⚠仓库内/);
});
