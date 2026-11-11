#!/usr/bin/env node
// 并行包文件域不相交检查(扇出前必跑):两个写代码的包不得碰同一个文件。
// 用法: node check-disjoint.mjs --pkg A=a.allow.txt --pkg B=b.allow.txt [--pkg C=…]
//   每个白名单文件:每行一个 glob;# 注释;! 开头为该包黑名单。
// 现有文件被两个以上的包同时覆盖 → 退出码 1(不能并行,合并成一个包或排成先后依赖)。
// 只是 glob 字面前缀相交(新建文件才可能撞)→ WARN,不失败:派包前人工确认或收窄 glob。

import { parseArgs, readAllowFile, matcher, trackedFiles, prefixesOverlap, repoRoot } from '../../_lib/glob.mjs';

const args = parseArgs();
const pkgs = args.all('pkg').map((spec) => {
  const eq = spec.indexOf('=');
  if (eq < 1) {
    console.error(`--pkg 需要 <包ID>=<白名单文件>,收到:${spec}`);
    process.exit(2);
  }
  const { allow, deny } = readAllowFile(spec.slice(eq + 1));
  return { id: spec.slice(0, eq), allow, deny, allowed: matcher(allow), denied: matcher(deny) };
});
if (pkgs.length < 2) {
  console.error('至少给两个 --pkg <包ID>=<白名单文件>');
  process.exit(2);
}
const empty = pkgs.filter((p) => p.allow.length === 0);
if (empty.length) {
  console.error(`白名单为空:${empty.map((p) => p.id).join(', ')}`);
  process.exit(2);
}

const conflicts = [];
for (const path of trackedFiles(repoRoot())) {
  const owners = pkgs.filter((p) => p.allowed(path) && !p.denied(path)).map((p) => p.id);
  if (owners.length > 1) conflicts.push({ path, owners });
}
const warns = [];
for (let i = 0; i < pkgs.length; i += 1)
  for (let j = i + 1; j < pkgs.length; j += 1)
    for (const a of pkgs[i].allow)
      for (const b of pkgs[j].allow)
        if (prefixesOverlap(a, b) && !conflicts.some((c) => c.owners.includes(pkgs[i].id) && c.owners.includes(pkgs[j].id)))
          warns.push(`${pkgs[i].id}: ${a}  ~  ${pkgs[j].id}: ${b}`);

for (const c of conflicts.slice(0, 60)) console.log(`  ✗ ${c.path}  (${c.owners.join(' + ')})`);
if (conflicts.length > 60) console.log(`  … 另 ${conflicts.length - 60} 个`);
for (const w of [...new Set(warns)]) console.log(`WARN  前缀相交,新建文件可能相撞:${w}`);
console.log(`${pkgs.length} 个包,重叠文件 ${conflicts.length} 个` + (conflicts.length ? ':不能并行——合并成一个包,或排成先后依赖。' : ':文件域不相交,可以并行。'));
process.exit(conflicts.length ? 1 : 0);
