#!/usr/bin/env node
// 任务包白名单检查(审核必跑,在被审仓库/worktree 内执行):列出 base 以来的全部改动
// (已提交 + 工作区未提交 + 未跟踪),逐个对照冻结合同的白名单/黑名单,并标出每个文件落在哪条泳道。
// 白名单外、命中黑名单、非 base 后代、或超过 --max-lane → 退出码 1;配置/参数问题 → 2。
// 红线取自仓库根 AGENTS.md frontmatter 的 redline_globs,恒为黑名单。
// 用法:
//   node check-package-whitelist.mjs --base <SHA> --allow 'src/foo/**' --allow 'tests/foo/*.test.ts' [--deny 'x/**'] [--head <ref>]
//   node check-package-whitelist.mjs --base <SHA> --allow-file <白名单文件>   # 每行一个 glob;# 注释;! 开头为黑名单
//   --max-lane contained|wide|closed|redline   合同声明的泳道上限;改动落到更严的泳道即失败(合同放开了某条红线时写 redline)
//   --allow-redline [<redline 里的 glob> …]   合同显式授权才用;不带值 = 放开全部红线,带值 = 只放开这几条
//   --allow-empty   确需允许 base 与目标之间 0 文件改动时显式传入(默认 0 改动判失败,防 --base 误传 HEAD 真空放行)
//   --allow-non-ancestor   确需跨分叉分支比对时显式传入(默认要求 base 是目标的祖先,防切错起点或在过期分支开工)
//   --config <path>   不用仓库根 AGENTS.md 时指定(.json 按旧式 .docflow.json 读)
// glob: ** 跨目录, * 不跨 /, ? 单字符。

import { spawnSync } from 'node:child_process';
import { loadProjectConfig, printWarnings, exitOnConfigError } from '../../_lib/agents-config.mjs';
import {
  parseArgs,
  readAllowFile,
  matcher,
  laneClassifier,
  changedSince,
  repoRoot,
  LANES,
  LANE_LABEL,
  worstLane,
} from '../../_lib/glob.mjs';

const args = parseArgs();
const base = args.one('base');
const head = args.one('head') ?? 'HEAD';
if (!base) {
  console.error('缺 --base <SHA>(取冻结合同里的“当前 base SHA”)');
  process.exit(2);
}
const root = repoRoot();

const allow = [...args.all('allow')];
const deny = [...args.all('deny')];
for (const file of args.all('allow-file')) {
  const parsed = readAllowFile(file);
  allow.push(...parsed.allow);
  deny.push(...parsed.deny);
}

const project = exitOnConfigError(() => {
  const p = loadProjectConfig(root, args.one('config'));
  p.need('redline');
  return p;
});
printWarnings(project);
const cfg = project.values;

const liftAll = args.flags.has('allow-redline');
const lifted = args.all('allow-redline');
const unknownLift = lifted.filter((g) => !cfg.redline.includes(g));
if (unknownLift.length) {
  console.error(`--allow-redline 的值必须是 ${project.keyName('redline')} 里的原样条目;不认识:${unknownLift.join(', ')}`);
  process.exit(2);
}
const activeRedline = liftAll ? [] : cfg.redline.filter((g) => !lifted.includes(g));
deny.push(...activeRedline);

const maxLane = args.one('max-lane');
if (maxLane && !LANES.includes(maxLane)) {
  console.error(`--max-lane 只能是 ${LANES.join(' | ')}`);
  process.exit(2);
}
if (allow.length === 0) {
  console.error('白名单为空:用 --allow 或 --allow-file 给出合同白名单');
  process.exit(2);
}

const allowed = matcher(allow);
const denied = matcher(deny);
const laneOf = laneClassifier(cfg);

const revParse = (ref) => {
  const r = spawnSync('git', ['rev-parse', '--verify', '-q', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};
const baseSha = revParse(base);
if (!baseSha) {
  console.error(`无效的 --base 引用: ${base}`);
  process.exit(2);
}
const headSha = revParse(head);
if (!headSha) {
  console.error(`无效的 --head 引用: ${head}`);
  process.exit(2);
}
const isAncestor = spawnSync('git', ['merge-base', '--is-ancestor', baseSha, headSha], { cwd: root }).status === 0;
let mergeBase = baseSha;
if (!isAncestor) {
  const mb = spawnSync('git', ['merge-base', baseSha, headSha], { cwd: root, encoding: 'utf8' });
  mergeBase = mb.status === 0 ? mb.stdout.trim() : null;
  if (!mergeBase) {
    console.log(`  ✗ ${head}(${headSha.slice(0, 10)}) 与合同 base(${baseSha.slice(0, 10)}) 无共同祖先:核对仓库或分支起点。`);
    process.exit(1);
  }
}

const changed = changedSince(root, base, head);
const bad = [];
const lanes = [];
for (const path of changed) {
  const hit = denied(path);
  const ok = !hit && Boolean(allowed(path));
  const { lane, glob } = laneOf(path);
  lanes.push(lane);
  const laneNote = lane === 'contained' ? '' : `  [${LANE_LABEL[lane]} ← ${glob}${lane === 'redline' && ok ? ',合同已授权' : ''}]`;
  console.log(`${ok ? '  ✓' : '  ✗'} ${path}${hit ? `  (黑名单 ${hit})` : ok ? '' : '  (白名单外)'}${laneNote}`);
  if (!ok) bad.push(path);
}
console.log(
  `改动 ${changed.length} 个文件,越界 ${bad.length} 个(base ${base.slice(0, 10)}…${head};红线 ${cfg.redline.length} 条` +
    `${liftAll ? ',本次全部放开' : lifted.length ? `,本次放开 ${lifted.length} 条` : ''})`,
);

const worst = worstLane(lanes);
const count = (l) => lanes.filter((x) => x === l).length;
console.log(
  `泳道:最严 = ${LANE_LABEL[worst]}(${LANES.filter((l) => count(l)).map((l) => `${LANE_LABEL[l]} ${count(l)}`).join(' / ') || '无改动'})` +
    (cfg.closedLane === undefined ? `;未配置 ${project.keyName('closedLane')},封死泳道未参与判定` : ''),
);
if (worst === 'closed' || worst === 'redline')
  console.log('  ! 触及封死泳道/红线:机检与 ACCEPT 都不放行 merge,需 owner 对本次改动逐次明确授权并写明回退路径。');

let nonAncestor = false;
if (!isAncestor && !args.flags.has('allow-non-ancestor')) {
  nonAncestor = true;
  console.log(
    `  ✗ ${head}(${headSha.slice(0, 10)}) 并非基于合同 base(${baseSha.slice(0, 10)}) 构建` +
      `(实际分叉点 ${mergeBase.slice(0, 10)}):切错了起点或漏了 git fetch/rebase(确需跨分支比对加 --allow-non-ancestor)。`,
  );
}
let emptyDiff = false;
if (changed.length === 0 && !args.flags.has('allow-empty')) {
  emptyDiff = true;
  console.log(`  ✗ base(${base.slice(0, 10)})与 ${head} 之间无任何文件改动:核对 --base 是否误传成了 HEAD(确需放行空改动加 --allow-empty)。`);
}
let laneExceeded = false;
if (maxLane && LANES.indexOf(worst) > LANES.indexOf(maxLane)) {
  laneExceeded = true;
  console.log(`  ✗ 超过合同泳道上限 ${LANE_LABEL[maxLane]}:不得 ACCEPT;重新定级或 ESCALATE。`);
}
process.exit(bad.length || laneExceeded || emptyDiff || nonAncestor ? 1 : 0);
