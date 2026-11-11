#!/usr/bin/env node
// 项目体检:这个仓库的 AGENTS.md 是否仍是「唯一、够薄、机器可读」的项目配置,以及有没有规则散落到别处。
// 只读;在目标仓库内执行。
//   node doctor.mjs                 体检。退出码 1 = 有 ERROR
//   node doctor.mjs --init          不写盘,打印一份 frontmatter 草稿(从仓库探测 + 旧 .docflow.json);每条带依据
//   node doctor.mjs --init --write  把草稿写到 AGENTS.md 顶部(已有 frontmatter 时拒绝;AGENTS.md 不存在则按模板新建,--name 给项目名)
// 草稿是起点:编排者核对后可以收紧;放松(删红线、把路径挪出封死泳道、删验收命令)要 owner 明确同意。

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  loadProjectConfig,
  parseFrontmatter,
  renderFrontmatter,
  ConfigError,
  CORE_KEYS,
  SUPPORTED_SCHEMA,
  CONFIG_FILE,
  LEGACY_FILE,
} from '../../_lib/agents-config.mjs';
import { parseArgs, globToRegExp, matcher, trackedFiles, repoRoot } from '../../_lib/glob.mjs';

const args = parseArgs();
const root = repoRoot();
const here = dirname(fileURLToPath(import.meta.url));
const tracked = trackedFiles(root);
const tryGit = (...a) => {
  try {
    return execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};
const has = (p) => existsSync(join(root, p));
const read = (p) => readFileSync(join(root, p), 'utf8');

// ---------- 探测(给 --init 出草稿,也给体检提「建议收紧」) ----------
function probe() {
  const v = {};
  const why = {};
  const note = (k, text) => (why[k] ??= []).push(text);

  const remotes = (tryGit('remote') ?? '').split('\n').filter(Boolean);
  if (remotes.length) {
    v.remote = remotes.includes('origin') ? 'origin' : remotes[0];
    note('remote', `依据:git remote = ${remotes.join(', ')}`);
    const headRef = tryGit('symbolic-ref', '--short', `refs/remotes/${v.remote}/HEAD`);
    v.mainBranch = headRef
      ? headRef.split('/').slice(1).join('/')
      : (['main', 'master'].find((b) => tryGit('rev-parse', '--verify', '-q', `refs/remotes/${v.remote}/${b}`)) ?? 'main');
  } else {
    v.remote = 'local';
    v.mainBranch = tryGit('symbolic-ref', '--short', 'HEAD') ?? 'main';
    note('remote', '依据:仓库没有 git remote;纯本地仓填 "local",建好远端后改为远端名');
  }

  const cmds = [];
  if (has('Makefile')) {
    const mk = read('Makefile');
    const target = ['ci', 'check', 'test'].find((t) => new RegExp(`^${t}:`, 'm').test(mk));
    if (target) cmds.push(`make ${target}`);
  }
  if (!cmds.length && has('package.json')) {
    const scripts = JSON.parse(read('package.json')).scripts ?? {};
    const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun run' : 'npm run';
    for (const s of ['lint', 'typecheck', 'check', 'test', 'build']) if (scripts[s]) cmds.push(`${pm} ${s}`);
  }
  if (!cmds.length && has('go.mod')) cmds.push('go vet ./...', 'go test ./...');
  if (!cmds.length && has('Cargo.toml')) cmds.push('cargo test');
  if (!cmds.length && has('pyproject.toml')) cmds.push('pytest');
  v.checkCmds = cmds;
  note('checkCmds', cmds.length ? '依据:Makefile / package.json scripts / 语言默认;核对哪些真能判败' : '没探测到验收命令:没有能判败的检查就没有闸门,必须补');

  const closed = new Set();
  const dirsLike = (re) => new Set(tracked.map((p) => re.exec(p)?.[1]).filter(Boolean));
  for (const d of dirsLike(/^((?:.*\/)?migrations)\//)) closed.add(`${d}/**`);
  for (const d of dirsLike(/(?:^|\/)(payments?|billing|wallet|refunds?)\//i)) closed.add(`**/${d}/**`);
  for (const d of ['.github/workflows', '.gitea/workflows', 'deploy', 'k8s', 'terraform', 'infra'])
    if (tracked.some((p) => p.startsWith(`${d}/`))) closed.add(`${d}/**`);
  if (tracked.some((p) => /^scripts\/deploy/.test(p))) closed.add('scripts/deploy*');
  if (tracked.some((p) => /^Dockerfile/.test(p))) closed.add('Dockerfile*');
  if (tracked.some((p) => /^docker-compose.*\.ya?ml$/.test(p))) closed.add('docker-compose*.yml');
  v.closedLane = [...closed].sort();
  note('closedLane', '依据:迁移/钱账/部署/CI 路径——改错了难撤回。拿不准的先留在这里,放松要 owner 同意');

  const red = [CONFIG_FILE];
  for (const d of ['vendor', 'third_party']) if (tracked.some((p) => p.startsWith(`${d}/`))) red.push(`${d}/**`);
  v.redline = red;
  note('redline', '依据:规则文件本身只有编排者能改;第三方代码只读。项目特有的只读目录在这里追加');

  const wide = ['package.json', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'pyproject.toml'].filter((p) =>
    tracked.includes(p),
  );
  v.wideLane = wide;
  note('wideLane', '依据:依赖清单,所有调用方共用。公共工具目录、共享 schema、i18n 词条等按项目追加');
  return { values: v, why };
}

// ---------- --init ----------
if (args.flags.has('init')) {
  const agentsPath = join(root, CONFIG_FILE);
  const existing = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : null;
  let already = null;
  try {
    already = existing && parseFrontmatter(existing, CONFIG_FILE);
  } catch {
    already = true;
  }
  if (already) {
    console.error(`${CONFIG_FILE} 已有 frontmatter:直接改它,然后跑 doctor.mjs 体检。`);
    process.exit(2);
  }
  const { values: probed, why } = probe();
  let legacy = {};
  if (has(LEGACY_FILE)) {
    try {
      legacy = loadProjectConfig(root, join(root, LEGACY_FILE)).values;
      for (const k of Object.keys(legacy)) why[k] = [`依据:原 ${LEGACY_FILE}`];
    } catch (error) {
      console.error(`WARN  ${error.message}`);
    }
  }
  const values = { schema: SUPPORTED_SCHEMA, ...probed, ...legacy };
  // 红线只增不减:旧配置的红线与探测到的合并
  values.redline = [...new Set([...(legacy.redline ?? []), ...probed.redline])];
  if (legacy.redline) why.redline = [`依据:原 ${LEGACY_FILE} 的 redline + 规则文件本身`];
  const draft = renderFrontmatter(values, why);
  if (!args.flags.has('write')) {
    console.log(draft);
    console.error(`\n以上是草稿,未写盘。核对后:doctor.mjs --init --write${has(LEGACY_FILE) ? `,再 git rm ${LEGACY_FILE}` : ''}`);
    process.exit(0);
  }
  let body = existing;
  if (body === null) {
    const name = args.one('name') ?? root.split('/').pop();
    body = readFileSync(resolve(here, '../references/AGENTS.template.md'), 'utf8').replaceAll('{{项目名}}', name);
  }
  writeFileSync(agentsPath, `${draft}\n\n${body.replace(/^\n+/, '')}`);
  console.log(`已写入 ${CONFIG_FILE} 顶部 frontmatter(未提交)。` + (has(LEGACY_FILE) ? `核对后 git rm ${LEGACY_FILE}。` : '') + '接着跑 doctor.mjs。');
  process.exit(0);
}

// ---------- 体检 ----------
const errors = [];
const warns = [];
const infos = [];
let project = null;
if (!has(CONFIG_FILE)) errors.push(`缺 ${CONFIG_FILE}:跑 doctor.mjs --init --write 新建。`);
else {
  try {
    project = loadProjectConfig(root);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    errors.push(error.message);
  }
}

if (project) {
  const cfg = project.values;
  const key = project.keyName;
  if (project.source === null) errors.push(`${CONFIG_FILE} 顶部没有 frontmatter:跑 doctor.mjs --init 出草稿。`);
  if (project.source === 'legacy-json')
    errors.push(`项目配置还在旧式 ${LEGACY_FILE}:跑 doctor.mjs --init --write 迁到 ${CONFIG_FILE} frontmatter,再删 ${LEGACY_FILE}。`);
  if (project.source === 'frontmatter') {
    if (has(LEGACY_FILE)) errors.push(`${LEGACY_FILE} 仍在:它是第二份真源,脚本已不读它,删掉。`);
    const missing = CORE_KEYS.filter((k) => cfg[k] === undefined);
    if (missing.length) errors.push(`frontmatter 缺必填字段:${missing.map(key).join('、')}(确实没有时数组写 [])。`);
    if (cfg.schema < SUPPORTED_SCHEMA)
      warns.push(`orchestrator_schema ${cfg.schema} 落后于本机 skill 的 ${SUPPORTED_SCHEMA}:按 references/project-config.md 的升级说明补字段后改版本号。`);

    const count = (g) => {
      const m = matcher([g]);
      return tracked.filter((p) => m(p)).length;
    };
    const isIgnoredRedline = (g) => {
      const isDirGlob = /\/\*\*?$/.test(g);
      const prefix = g.replace(/\/\*\*?$/, '');
      if (!prefix || /[*?]/.test(prefix)) return false;
      return tryGit('check-ignore', '-q', isDirGlob ? `${prefix}/` : prefix) !== null;
    };
    for (const k of ['redline', 'closedLane', 'wideLane'])
      for (const g of cfg[k] ?? [])
        if (count(g) === 0 && !(k === 'redline' && isIgnoredRedline(g)))
          warns.push(`${key(k)} 的 ${g} 没匹配到任何已跟踪文件:路径改名了,还是写错了?`);

    const remotes = (tryGit('remote') ?? '').split('\n').filter(Boolean);
    if (cfg.remote === 'local') {
      if (remotes.length > 0)
        errors.push(`remote 填了 "local"(仅用于纯本地仓),但仓库已有远端(${remotes.join(', ')}):改为实际远端名。`);
      else if (cfg.mainBranch && !tryGit('rev-parse', '--verify', '-q', `refs/heads/${cfg.mainBranch}`))
        errors.push(`找不到本地主分支 ${cfg.mainBranch}:核对 main_branch。`);
    } else if (cfg.remote && !remotes.includes(cfg.remote)) {
      errors.push(`remote "${cfg.remote}" 不在 git remote(${remotes.join(', ') || '无'})里。`);
    } else if (cfg.remote && cfg.mainBranch && !tryGit('rev-parse', '--verify', '-q', `refs/remotes/${cfg.remote}/${cfg.mainBranch}`)) {
      warns.push(`找不到 ${cfg.remote}/${cfg.mainBranch}:先 git fetch ${cfg.remote},或核对 main_branch。`);
    }
    if (cfg.checkCmds && cfg.checkCmds.length === 0) warns.push('check_cmds 为空:没有能判败的机检,闸门只剩人工。');
    for (const k of ['contractDoc', 'baselineDoc', 'roadmap', 'ledger', 'index'])
      if (cfg[k] && !has(cfg[k])) errors.push(`${key(k)} 指向的 ${cfg[k]} 不存在。`);

    // 探测到却没被任何受限泳道覆盖的高风险路径:建议收紧(收紧不需要 owner 审批)
    const guarded = matcher([...(cfg.redline ?? []), ...(cfg.closedLane ?? [])]);
    const candidate = probe().values.closedLane.filter((g) => {
      const m = matcher([g]);
      return tracked.some((p) => m(p) && !guarded(p));
    });
    for (const g of candidate) warns.push(`建议收紧:${g} 下有文件不在 redline_globs / closed_lane_globs 里(迁移/钱账/部署类路径)。`);

    const body = project.bodyLines ?? [];
    const lines = body.filter((l) => l.trim()).length;
    if (lines > 90)
      warns.push(`${CONFIG_FILE} 正文 ${lines} 行(非空):它每个会话都要读。流程性内容交给全局 skill,这里只留项目事实与 glob 表达不了的红线。`);
    if (!body.join('\n').includes('task-package-orchestration'))
      warns.push(`${CONFIG_FILE} 正文没有指向 task-package-orchestration:编排者不知道去哪读流程。`);
    infos.push(
      `${CONFIG_FILE}: schema ${cfg.schema} / 红线 ${cfg.redline?.length ?? '-'} / 封死 ${cfg.closedLane?.length ?? '-'} / 面广 ${cfg.wideLane?.length ?? 0} / 验收命令 ${cfg.checkCmds?.length ?? '-'} / 正文 ${lines} 行`,
    );

    // 确定性冷启动快照:让新开的总工会话一条命令看清现场、路由入口与唯一下一包,免去扫目录与翻冷区
    const branch = tryGit('--no-optional-locks', 'symbolic-ref', '--short', 'HEAD') ?? '(detached)';
    const headSha = (tryGit('--no-optional-locks', 'rev-parse', '--short=10', 'HEAD') ?? '-');
    let syncNote = cfg.remote === 'local' ? '纯本地仓' : `远端 ${cfg.remote}/${cfg.mainBranch} 未检出`;
    if (cfg.remote && cfg.remote !== 'local' && cfg.mainBranch) {
      const lr = tryGit('--no-optional-locks', 'rev-list', '--left-right', '--count', `HEAD...refs/remotes/${cfg.remote}/${cfg.mainBranch}`);
      if (lr) {
        const [ahead, behind] = lr.split(/\s+/);
        syncNote = `相对 ${cfg.remote}/${cfg.mainBranch} +${ahead}/-${behind}`;
      }
    }
    const dirtyTracked = (tryGit('--no-optional-locks', 'status', '--porcelain', '-uno') ?? '').split('\n').filter(Boolean).length;
    const wtCount = Math.max(0, (tryGit('--no-optional-locks', 'worktree', 'list', '--porcelain') ?? '').split('\n\n').filter(Boolean).length - 1);
    infos.push(`现场: ${branch}@${headSha} | ${syncNote} | 已跟踪未提交 ${dirtyTracked} | 附加 worktree ${wtCount}`);

    const resolveSingleDoc = (pattern) => {
      if (!pattern) return [];
      if (!/[*?]/.test(pattern)) return has(pattern) ? [pattern] : [];
      const dir = dirname(pattern);
      const re = globToRegExp(basename(pattern));
      if (!has(dir)) return [];
      return readdirSync(join(root, dir))
        .filter((n) => re.test(n))
        .sort()
        .map((n) => (dir === '.' ? n : `${dir}/${n}`));
    };
    const checkSingleDoc = (k) => {
      const pattern = cfg[k];
      if (!pattern) return null;
      const hits = resolveSingleDoc(pattern);
      if (hits.length === 0) errors.push(`${key(k)} (${pattern}) 未匹配到文件。`);
      else if (hits.length > 1) errors.push(`${key(k)} (${pattern}) 匹配到 ${hits.length} 份(${hits.join(', ')}):现行热区必须恰好 1 份。`);
      return hits.length === 1 ? hits[0] : null;
    };
    const planPath = checkSingleDoc('plan');
    const decisionsPath = checkSingleDoc('decisions');
    const exactDoc = (p) => (p && has(p) ? p : null);
    const routes = [
      ['路线图', exactDoc(cfg.roadmap)],
      ['排期', planPath],
      ['决策', decisionsPath],
      ['台账', exactDoc(cfg.ledger)],
      ['契约', exactDoc(cfg.contractDoc)],
      ['基线', exactDoc(cfg.baselineDoc)],
      ['索引', exactDoc(cfg.index)],
    ]
      .filter(([, p]) => p)
      .map(([label, p]) => `${label}=${p}`);
    if (routes.length) infos.push(`路由: ${routes.join(' | ')}`);

    if (planPath) {
      const marker = cfg.nextPackageMarker ?? '**唯一下一包**';
      const nextLine = read(planPath)
        .split(/\r?\n/)
        .find((l) => l.includes(marker));
      if (nextLine) infos.push(`下一包: ${nextLine.trim()}`);
    }
  }
}

// 规则散落:别的入口文件应该只是指针;项目内不该再有一份编排协议或脚本副本
for (const f of ['CLAUDE.md', 'GEMINI.md', '.cursorrules', '.github/copilot-instructions.md']) {
  if (!has(f)) continue;
  const text = read(f);
  const n = text.split('\n').filter((l) => l.trim()).length;
  if (n > 8) warns.push(`${f} 有 ${n} 行:它应该只是指向 ${CONFIG_FILE} 的指针,规则写在这里会和 ${CONFIG_FILE} 漂移。`);
  if (!has('.agents/skills') && /(?<![~/])\.agents\/skills\//.test(text))
    warns.push(`${f} 仍引用仓内 .agents/skills/(该目录已不存在):改为指向 ${CONFIG_FILE} 与全局 skill。`);
}
for (const f of tracked.filter((p) => /(^|\/)\.(agents|claude|codex)\/skills\/.+\/SKILL\.md$/.test(p)))
  if (/REWORK_ONCE/.test(read(f)))
    warns.push(`${f} 是项目内的编排协议副本:流程以全局 task-package-orchestration 为准,项目特有事实并入 ${CONFIG_FILE} 后删掉它。`);
for (const f of tracked.filter((p) => /(^|\/)(check-package-whitelist|check-doc-flow|doc-cold-archive)\.mjs$/.test(p)))
  warns.push(`${f} 是 skill 脚本的项目内副本:它不读 frontmatter,会带着自己的红线/路径漂移。改成调用全局 skill 的脚本。`);
for (const f of tracked.filter((p) => /(^|\/)AGENTS\.md$/.test(p) && p !== CONFIG_FILE)) {
  const n = read(f).split('\n').filter((l) => l.trim()).length;
  if (n > 8) warns.push(`子目录 ${f} 有 ${n} 行规则:确认它只写该子目录特有的事实,不重复根 ${CONFIG_FILE}。`);
}

for (const i of infos) console.log(i);
for (const w of warns) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`体检:${errors.length} ERROR / ${warns.length} WARN` + (errors.length + warns.length === 0 ? ' —— 项目配置唯一、机器可读、无散落。' : ''));
process.exit(errors.length ? 1 : 0);
