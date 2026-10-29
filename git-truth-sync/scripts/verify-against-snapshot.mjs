#!/usr/bin/env node
// 前移后核对:分类里的真 WIP 与本机独有文件,是否与快照逐字节(符号链接按目标)一致。
// 用法: node verify-against-snapshot.mjs --snapshot <快照分支> --classify <gts-classify.json> [--old <前移前HEAD>]
// 对 code_tracked / doc_tracked_genuine:若目标分支也改过该文件(三方合并),报 "merged" 让人工看,不算失败。

import { readFileSync } from 'node:fs';
import { git, opts, treeIndex, worktreeIds, sameAs } from './gts-lib.mjs';

const { o } = opts();
if (!o.snapshot || !o.classify) {
  console.error('用法: node verify-against-snapshot.mjs --snapshot <分支> --classify <json> [--old <ref>]');
  process.exit(2);
}
const c = JSON.parse(readFileSync(o.classify, 'utf8'));
const snap = treeIndex(o.snapshot);
const old = treeIndex(o.old ?? c.head);
const now = treeIndex('HEAD');
const paths = [...c.code_tracked, ...c.doc_tracked_genuine, ...c.untracked_genuine];
const ids = worktreeIds(paths);
const res = { same: 0, merged: [], differs: [], missing: [] };
for (const p of paths) {
  const want = snap.get(p) ?? null; // 快照里没有 = WIP 是删除
  const id = ids.get(p);
  if (sameAs(id, want)) res.same += 1;
  else if (id === null && want) res.missing.push(p);
  else if (old.has(p) && now.has(p) && old.get(p).blob !== now.get(p).blob) res.merged.push(p); // 目标分支也改过 → 三方合并结果
  else res.differs.push(p);
}
console.log(`核对 ${paths.length} 个 | 一致 ${res.same} | 三方合并待人工看 ${res.merged.length} | 不一致 ${res.differs.length} | 缺失 ${res.missing.length}`);
for (const [k, list] of [['merged', res.merged], ['differs', res.differs], ['missing', res.missing]])
  for (const p of list.slice(0, 30)) console.log(`  ${k.padEnd(8)} ${p}`);
process.exit(res.differs.length || res.missing.length ? 1 : 0);
