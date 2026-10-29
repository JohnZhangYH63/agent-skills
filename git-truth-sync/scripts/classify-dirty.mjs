#!/usr/bin/env node
// 前移主检出前给工作区的每个改动分类,区分"真 WIP"和"从别处拷进来的旧副本"。
// 用法: node classify-dirty.mjs --target <要前移到的ref> [--copy-ref <文档副本来源ref>] [--out <json>]
//   --copy-ref: 文档若是从某分支整套拷进工作区的(常见于"未提交同步导航"),给出该分支;
//               文档路径下与它逐字节相同的改动/未跟踪文件判为 stale(安全可移走)。
// 输出类别:
//   code_tracked          受管文档之外的已跟踪改动 → 存补丁,前移后三方合并放回
//   doc_tracked_stale     文档已跟踪改动,内容 == copy-ref → 前移后由目标版本取代
//   doc_tracked_genuine   文档已跟踪改动,内容 ≠ copy-ref → 真改动,前移后放回(目标也改过则三方合并)
//   untracked_stale       未跟踪且 == copy-ref → 可移走(copy-ref/快照里都有)
//   untracked_genuine     其余未跟踪 → 原地不动
//   blocking              untracked_genuine 中与 target 同名的路径 → 会挡住快进,必须人工处理
// 符号链接按链接目标比对(git hash-object 会跟随链接,直接比会误报)。

import { writeFileSync } from 'node:fs';
import { git, loadConfig, opts, treeIndex, worktreeIds, sameAs, isDocPath } from './gts-lib.mjs';

const { o } = opts();
if (!o.target) {
  console.error('用法: node classify-dirty.mjs --target <ref> [--copy-ref <ref>] [--out <json>]');
  process.exit(2);
}
const cfg = loadConfig(o.config);
const copy = o['copy-ref'] ? treeIndex(o['copy-ref']) : null;
const target = treeIndex(o.target);
const split = (s) => s.split('\0').filter(Boolean);

const tracked = split(git('diff', '--name-only', '-z', 'HEAD'));
const untracked = split(git('ls-files', '--others', '--exclude-standard', '-z'));
const ids = worktreeIds([...tracked, ...untracked]);
const out = { head: git('rev-parse', 'HEAD'), target: o.target, copyRef: o['copy-ref'] ?? null, code_tracked: [], doc_tracked_stale: [], doc_tracked_genuine: [], untracked_stale: [], untracked_genuine: [], blocking: [] };

for (const p of tracked) {
  if (!isDocPath(cfg, p)) out.code_tracked.push(p);
  else if (copy && sameAs(ids.get(p), copy.get(p) ?? null)) out.doc_tracked_stale.push(p);
  else out.doc_tracked_genuine.push(p);
}
for (const p of untracked) {
  if (copy && isDocPath(cfg, p) && copy.has(p) && sameAs(ids.get(p), copy.get(p))) out.untracked_stale.push(p);
  else {
    out.untracked_genuine.push(p);
    if (target.has(p)) out.blocking.push(p);
  }
}
for (const k of Object.keys(out)) if (Array.isArray(out[k])) console.log(`${k.padEnd(20)} ${out[k].length}`);
if (out.blocking.length) console.log('⚠ blocking(会挡快进):\n  ' + out.blocking.slice(0, 20).join('\n  '));
const file = o.out ?? 'gts-classify.json';
writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`分类写入 ${file}`);
