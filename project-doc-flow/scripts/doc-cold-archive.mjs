#!/usr/bin/env node
// 关账转冷:把热区目录(config.hotDir)根部已完成的过程稿移入 <archiveDir>/<日期>/,同时
//  1) 重算被移文件内部的相对链接;2) 改写全部受管 Markdown 指向它们的入链(含未提交文档);
//  3) 生成 manifest.json(原路径/源提交/前后 sha256/再读触发词/未结项)与按触发词读的 README.md;
//  4) git add 冷区与被改写入链的文件(不 commit)。
// 只搬运,不判断"该不该冷"——先把仍有效的决定与未结项回填决策页/排期页,再跑本脚本。
//
// 用法: node doc-cold-archive.mjs <清单.json> [--config <path>] [--dry-run]
// 清单: { "date": "YYYY-MM-DD", "scope": "本批说明", "readme_intro"?: "...", "readme_extra"?: "...",
//         "groups": [{ "files": ["热区根部文件名.md"], "scope": "完成范围", "triggers": ["再读触发词"], "open_items": "未结项去向" }] }

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import {
  parseArgs,
  repoRootFrom,
  loadConfig,
  git,
  collectManagedMarkdown,
  rewriteLinks,
  resolveTarget,
  relativeLink,
  toRepoPath,
} from './docflow-lib.mjs';

const args = parseArgs();
const dryRun = args.flags.has('dry-run');
const specPath = args.positional[0];
if (!specPath) {
  console.error('用法: node doc-cold-archive.mjs <清单.json> [--config <path>] [--dry-run]');
  process.exit(2);
}
const root = repoRootFrom();
const cfg = loadConfig(root, args.one('config'));
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.date ?? '')) throw new Error('清单 date 须为 YYYY-MM-DD');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const hotDir = join(root, cfg.hotDir);
const archiveDir = join(root, cfg.archiveDir, spec.date);
const base = git(root, 'rev-parse', 'HEAD');
const rel = (abs) => toRepoPath(root, abs);

// 1. 校验并建映射
const moves = new Map();
const rows = [];
const problems = [];
for (const group of spec.groups) {
  for (const name of group.files) {
    const oldAbs = join(hotDir, name);
    const newAbs = join(archiveDir, name);
    if (name.includes('/')) problems.push(`只收热区根部文件: ${name}`);
    else if (!existsSync(oldAbs)) problems.push(`不存在: ${rel(oldAbs)}`);
    else if (existsSync(newAbs)) problems.push(`冷区已有同名: ${rel(newAbs)}`);
    else if (git(root, 'status', '--porcelain', '--', rel(oldAbs)) !== '') problems.push(`有未提交改动: ${rel(oldAbs)}`);
    else if (moves.has(oldAbs)) problems.push(`重复列出: ${rel(oldAbs)}`);
    moves.set(oldAbs, newAbs);
    rows.push({ oldAbs, newAbs, group });
  }
}
if (problems.length) {
  for (const p of problems) console.error('  ✗', p);
  process.exit(1);
}
const mapTarget = (abs) => moves.get(abs) ?? abs;

// 2. 被移文件:按旧位置解析、按新位置重算
const moved = new Map();
for (const { oldAbs, newAbs } of rows) {
  const raw = readFileSync(oldAbs);
  const text = rewriteLinks(raw.toString('utf8'), (t) => {
    const abs = resolveTarget(root, oldAbs, t);
    return existsSync(abs) ? relativeLink(newAbs, mapTarget(abs), t) : null;
  });
  moved.set(oldAbs, { raw, text });
}

// 3. 入链
const incoming = new Map();
for (const file of collectManagedMarkdown(root, cfg)) {
  if (moves.has(file)) continue;
  const before = readFileSync(file, 'utf8');
  const after = rewriteLinks(before, (t) => {
    const abs = resolveTarget(root, file, t);
    return moves.has(abs) ? relativeLink(file, moves.get(abs), t) : null;
  });
  if (after !== before) incoming.set(file, after);
}

console.log(`${dryRun ? '[dry-run] ' : ''}转冷 ${rows.length} 篇 → ${rel(archiveDir)}/`);
console.log(`入链改写 ${incoming.size} 份: ${[...incoming.keys()].map(rel).join(', ') || '无'}`);
if (dryRun) process.exit(0);

// 4. 落盘
mkdirSync(archiveDir, { recursive: true });
const manifestRows = [];
for (const { oldAbs, newAbs, group } of rows) {
  const sourceCommit = git(root, 'log', '-1', '--format=%H', '--', rel(oldAbs));
  git(root, 'mv', rel(oldAbs), rel(newAbs));
  const { raw, text } = moved.get(oldAbs);
  writeFileSync(newAbs, text);
  manifestRows.push({
    old_path: rel(oldAbs),
    cold_path: rel(newAbs),
    scope: group.scope,
    source_commit: sourceCommit,
    source_sha256: sha256(raw),
    cold_sha256: sha256(Buffer.from(text, 'utf8')),
    reread_triggers: group.triggers,
    open_items: group.open_items,
  });
}
for (const [file, text] of incoming) writeFileSync(file, text);

writeFileSync(
  join(archiveDir, 'manifest.json'),
  JSON.stringify(
    {
      date: spec.date,
      base,
      scope: spec.scope,
      archive_count: manifestRows.length,
      incoming_markdown_updates: [...incoming.keys()].map(rel),
      rows: manifestRows,
    },
    null,
    2,
  ) + '\n',
);

const cell = (s) => String(s ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const readme = [
  `# 冷区索引 · ${spec.date}`,
  '',
  spec.readme_intro ?? `${cell(spec.scope)}。本目录只按问题读取,不参与当前排期,不得从这里恢复"下一包"。`,
  '',
  "原路径、源提交、原文与冷稿 sha256、再读触发词与未结项见 [manifest](manifest.json)。需要原始字节时用 `git show '<source_commit>:<old_path>'`。原始证据不随正文搬动。",
  '',
  '## 按触发词读',
  '',
  '| 历史稿 | 再读触发词 | 原记录完成范围 | 未结项去向 |',
  '|---|---|---|---|',
  ...manifestRows.map((r) => {
    const name = basename(r.cold_path);
    return `| [${name}](${name}) | ${cell(r.reread_triggers.join('；'))} | ${cell(r.scope)} | ${cell(r.open_items)} |`;
  }),
  '',
  spec.readme_extra ?? '',
].join('\n');
writeFileSync(join(archiveDir, 'README.md'), readme.trimEnd() + '\n');
// 未提交的文档(别的会话的 WIP)只改写链接、不替它暂存
const tracked = new Set(git(root, 'ls-files', '-z').split('\0').filter(Boolean));
const stage = [...incoming.keys()].map(rel).filter((p) => tracked.has(p));
git(root, 'add', '--', rel(archiveDir), ...stage);
console.log(`完成(已 git add,未 commit;${incoming.size - stage.length} 份未提交文档只改链接未暂存)。下一步: check-doc-flow.mjs`);
