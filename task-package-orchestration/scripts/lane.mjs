#!/usr/bin/env node
// 泳道判定(按「改错了撤回有多贵」分道,不按模型自信度):
//   派包前: node lane.mjs --allow 'src/x/**' [--allow-file f] [--deny g]     白名单会碰到哪条泳道
//   审核时: node lane.mjs --base <SHA> [--head <ref>]                       实际改动落在哪条泳道
// 泳道(由宽到严): contained 局部可逆 < wide 可逆但面广 < closed 封死 < redline 红线
// 取自 AGENTS.md frontmatter 的 wide_lane_globs / closed_lane_globs / redline_globs。
// 派包前的判定对「还不存在的文件」只能按 glob 字面前缀估计(标「可能」);审核时的 --base 判定才是准的。
// --max-lane <lane> 超过即退出码 1;--json 输出机器可读结果。

import { loadProjectConfig, printWarnings, exitOnConfigError } from '../../_lib/agents-config.mjs';
import {
  parseArgs,
  readAllowFile,
  matcher,
  laneClassifier,
  changedSince,
  trackedFiles,
  prefixesOverlap,
  repoRoot,
  LANES,
  LANE_LABEL,
  worstLane,
} from '../../_lib/glob.mjs';

const args = parseArgs();
const root = repoRoot();
const project = exitOnConfigError(() => {
  const p = loadProjectConfig(root, args.one('config'));
  p.need('redline', 'closedLane');
  return p;
});
printWarnings(project);
const cfg = project.values;
const laneOf = laneClassifier(cfg);

const base = args.one('base');
const allow = [...args.all('allow')];
const deny = [...args.all('deny')];
for (const file of args.all('allow-file')) {
  const parsed = readAllowFile(file);
  allow.push(...parsed.allow);
  deny.push(...parsed.deny);
}
if (!base && allow.length === 0) {
  console.error('用法: lane.mjs --base <SHA> [--head <ref>]   或   lane.mjs --allow <glob> … [--allow-file <f>]');
  process.exit(2);
}
const maxLane = args.one('max-lane');
if (maxLane && !LANES.includes(maxLane)) {
  console.error(`--max-lane 只能是 ${LANES.join(' | ')}`);
  process.exit(2);
}

let paths;
const maybe = [];
if (base) paths = changedSince(root, base, args.one('head') ?? 'HEAD');
else {
  const allowed = matcher(allow);
  const denied = matcher(deny);
  paths = trackedFiles(root).filter((p) => allowed(p) && !denied(p));
  // 白名单可能新建文件:与受限泳道的 glob 字面前缀相交就提示
  for (const [lane, globs] of [['redline', cfg.redline], ['closed', cfg.closedLane], ['wide', cfg.wideLane ?? []]])
    for (const g of globs) for (const a of allow) if (prefixesOverlap(a, g)) maybe.push({ lane, glob: g, allow: a });
}

const files = paths.map((p) => ({ path: p, ...laneOf(p) }));
const certain = worstLane(files.map((f) => f.lane));
const possible = worstLane([certain, ...maybe.map((m) => m.lane)]);
const exceeded = Boolean(maxLane) && LANES.indexOf(possible) > LANES.indexOf(maxLane);

if (args.flags.has('json')) {
  console.log(JSON.stringify({ mode: base ? 'diff' : 'whitelist', lane: certain, possibleLane: possible, exceeded, files: files.filter((f) => f.lane !== 'contained'), maybe }, null, 2));
} else {
  for (const lane of [...LANES].reverse()) {
    const hit = files.filter((f) => f.lane === lane);
    if (lane === 'contained' || hit.length === 0) continue;
    console.log(`${LANE_LABEL[lane]}(${hit.length}):`);
    for (const f of hit.slice(0, 40)) console.log(`  ${f.path}  ← ${f.glob}`);
    if (hit.length > 40) console.log(`  … 另 ${hit.length - 40} 个`);
  }
  for (const m of maybe) console.log(`可能触及 ${LANE_LABEL[m.lane]}:白名单 ${m.allow} 与 ${m.glob} 前缀相交(新建文件时会命中)`);
  console.log(`${base ? '实际改动' : '白名单覆盖现有文件'} ${files.length} 个;泳道 = ${LANE_LABEL[certain]}(${certain})` + (possible !== certain ? `,新建文件时可能升到 ${LANE_LABEL[possible]}(${possible})` : ''));
  if (possible === 'closed' || possible === 'redline')
    console.log('  ! 封死泳道/红线:不自动过闸。派包前先拿到 owner 对这次改动的明确授权,合同写明回退路径;拿不到就把这部分切出去。');
  else if (possible === 'wide') console.log('  · 面广:过闸要全部 check_cmds 结果 + 调用方证据 + 独立审核,不能只凭执行者报告。');
  if (exceeded) console.log(`  ✗ 超过上限 ${LANE_LABEL[maxLane]}`);
}
process.exit(exceeded ? 1 : 0);
