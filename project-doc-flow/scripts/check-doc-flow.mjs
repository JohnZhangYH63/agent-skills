#!/usr/bin/env node
// 文档流转门(改文档、关账、转冷后必跑;退出码 1 = 有 ERROR)。在目标仓库任意目录下执行。
//  1. 已提交的受管 Markdown 相对链接 0 坏链(未提交文档只计数发 WARN);
//  2. 排期页(config.plan)恰好一份,且恰有一行以 nextPackageMarker 开头的「唯一下一包」;
//  3. 总路线图(config.roadmap)存在且不超过 roadmapMaxBytes(它是路由器);
//  4. 热区目录(config.hotDir)根部的过程稿不超过 hotProcessLimit,超了先转冷;
//  5. 冷区每个日期目录都有 manifest.json 与 README.md;
//  6. 真源同步(WARN,--strict-sync 升 ERROR):本地主分支不落后远端,主检出不以未提交副本承载文档。
// 用法: node check-doc-flow.mjs [--config <path>] [--strict-sync] [--json]

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseArgs,
  repoRootFrom,
  loadConfig,
  tryGit,
  resolveSingle,
  collectManagedMarkdown,
  listLinks,
  resolveTarget,
  toRepoPath,
} from './docflow-lib.mjs';

const args = parseArgs();
const root = repoRootFrom();
const cfg = loadConfig(root, args.one('config'));
const errors = [];
const warnings = [];
const info = { config: cfg._path ? toRepoPath(root, cfg._path) || cfg._path : '(默认值,未找到 .docflow.json)' };

const tracked = new Set((tryGit(root, 'ls-files', '-z') ?? '').split('\0').filter(Boolean));
const isTracked = (abs) => tracked.has(toRepoPath(root, abs));

// 1. 链接
const managed = collectManagedMarkdown(root, cfg);
const files = managed.filter(isTracked);
info.markdown = files.length;
info.untrackedDocs = managed.length - files.length;
if (info.untrackedDocs > 0) warnings.push(`有 ${info.untrackedDocs} 份未提交的受管 Markdown,未纳入链接门`);
let links = 0;
for (const file of files) {
  for (const { line, target } of listLinks(readFileSync(file, 'utf8'))) {
    links += 1;
    if (!existsSync(resolveTarget(root, file, target))) errors.push(`坏链 ${toRepoPath(root, file)}:${line} -> ${target}`);
  }
}
info.links = links;

// 2. 排期页 + 唯一下一包
const plans = resolveSingle(root, cfg.plan);
if (plans.length !== 1) errors.push(`排期页 ${cfg.plan} 应恰好匹配 1 份,实际 ${plans.length}`);
else {
  const marker = cfg.nextPackageMarker;
  const hits = readFileSync(join(root, plans[0]), 'utf8')
    .split('\n')
    .filter((l) => l.trim().startsWith(marker) && /^[:：]/.test(l.trim().slice(marker.length)));
  if (hits.length !== 1) errors.push(`${plans[0]} 应恰有 1 行 "${marker}:",实际 ${hits.length}`);
  else info.nextPackage = hits[0].trim();
}

// 3. 总路线图
const roadmap = join(root, cfg.roadmap);
if (!existsSync(roadmap)) errors.push(`总路线图不存在: ${cfg.roadmap}`);
else {
  info.roadmapBytes = statSync(roadmap).size;
  if (info.roadmapBytes > cfg.roadmapMaxBytes)
    errors.push(`总路线图 ${info.roadmapBytes} 字节 > ${cfg.roadmapMaxBytes}:它是路由器,状态细节移到排期页/决策页`);
}

// 4. 热区过程稿
const hotDir = join(root, cfg.hotDir);
const processRe = new RegExp(cfg.processDocPattern, 'i');
const hot = existsSync(hotDir)
  ? readdirSync(hotDir).filter((n) => n.endsWith('.md') && processRe.test(n) && isTracked(join(hotDir, n)))
  : [];
info.hotProcessDocs = hot.length;
if (hot.length > cfg.hotProcessLimit)
  errors.push(`${cfg.hotDir} 根部过程稿 ${hot.length} 篇 > ${cfg.hotProcessLimit}:先回填有效结论,再跑 doc-cold-archive 转冷`);

// 5. 冷区结构
const archiveRoot = join(root, cfg.archiveDir);
if (existsSync(archiveRoot)) {
  for (const d of readdirSync(archiveRoot)) {
    const dir = join(archiveRoot, d);
    if (!statSync(dir).isDirectory()) continue;
    for (const must of ['manifest.json', 'README.md'])
      if (!existsSync(join(dir, must))) errors.push(`冷区 ${cfg.archiveDir}/${d}/ 缺 ${must}`);
  }
}

// 6. 真源同步
const branch = tryGit(root, 'rev-parse', '--abbrev-ref', 'HEAD');
const remoteRef = `${cfg.remote}/${cfg.mainBranch}`;
info.branch = branch;
if (branch === cfg.mainBranch && tryGit(root, 'rev-parse', '--verify', '-q', remoteRef)) {
  const [ahead, behind] = (tryGit(root, 'rev-list', '--left-right', '--count', `${cfg.mainBranch}...${remoteRef}`) ?? '0 0')
    .split(/\s+/)
    .map(Number);
  info.mainVsRemote = { ahead, behind };
  if (behind > 0) warnings.push(`本地 ${cfg.mainBranch} 落后 ${remoteRef} ${behind} 个提交:先保全 WIP 再前移(git-truth-sync)`);
  const docDirs = cfg.managed.filter((m) => m !== '*.md');
  const dirty = (tryGit(root, 'status', '--porcelain', '--', ...docDirs) ?? '').split('\n').filter(Boolean).length;
  if (dirty > 0) warnings.push(`有 ${dirty} 条未提交文档改动:文档真源须在提交里`);
}
if (args.flags.has('strict-sync')) errors.push(...warnings.splice(0));

if (args.flags.has('json')) console.log(JSON.stringify({ info, errors, warnings }, null, 2));
else {
  console.log(
    `配置 ${info.config} | 受管 Markdown ${info.markdown} / 链接 ${info.links} / 热区过程稿 ${info.hotProcessDocs}(上限 ${cfg.hotProcessLimit}) / 总路线图 ${info.roadmapBytes ?? '-'} 字节`,
  );
  if (info.nextPackage) console.log(`下一包: ${info.nextPackage}`);
  for (const w of warnings) console.log(`  WARN  ${w}`);
  for (const e of errors) console.log(`  ERROR ${e}`);
  console.log(errors.length ? `✗ ${errors.length} 个 ERROR` : '✓ 文档流转门通过');
}
process.exit(errors.length ? 1 : 0);
