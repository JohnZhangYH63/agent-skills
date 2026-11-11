#!/usr/bin/env node
// 给一个仓库铺好文档流转骨架:总路线图/排期页/决策页/台账/索引 + 热区与冷区目录。只创建不存在的文件,从不覆盖。
// 用法: node docflow-init.mjs --name <项目名> [--config <path>] [--dry-run]
//   路径取 AGENTS.md frontmatter 的 doc_* 字段,缺省用默认路径。AGENTS.md 与 frontmatter 由
//   task-package-orchestration 的 doctor.mjs --init --write 建,本脚本不碰。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { parseArgs, repoRootFrom, loadConfig, relativeLink } from './docflow-lib.mjs';

const args = parseArgs();
const name = args.one('name');
if (!name) {
  console.error('用法: node docflow-init.mjs --name <项目名> [--config <path>] [--dry-run]');
  process.exit(2);
}
const dryRun = args.flags.has('dry-run');
const root = repoRootFrom();
const cfg = loadConfig(root, args.one('config'));
const templates = resolve(dirname(new URL(import.meta.url).pathname), '../references/templates');
const today = new Date().toISOString().slice(0, 10);
const created = [];

const write = (rel, content) => {
  const abs = join(root, rel);
  if (existsSync(abs)) return;
  created.push(rel);
  if (dryRun) return;
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
};

const paths = {
  roadmap: cfg.roadmap,
  plan: cfg.plan.includes('*') ? cfg.plan.replace('*', today.replaceAll('-', '')) : cfg.plan,
  decisions: cfg.decisions.includes('*') ? cfg.decisions.replace('*', today.replaceAll('-', '')) : cfg.decisions,
  ledger: cfg.ledger,
  index: cfg.index,
  agents: 'AGENTS.md',
};
const files = [
  ['roadmap', '总路线图.md'],
  ['plan', '后续工程总计划.md'],
  ['decisions', '现行决策.md'],
  ['ledger', '完成台账.md'],
  ['index', '索引.md'],
];
for (const [key, tpl] of files) {
  const self = join(root, paths[key]);
  const content = readFileSync(join(templates, tpl), 'utf8')
    .replaceAll('{{项目名}}', name)
    .replaceAll('{{日期}}', today)
    .replaceAll('{{archiveDir}}', cfg.archiveDir)
    .replace(/\{\{link:(\w+)\}\}/g, (_, k) => relativeLink(self, join(root, paths[k]), paths[k]));
  write(paths[key], content);
}
for (const dir of [cfg.hotDir, cfg.archiveDir]) {
  const keep = `${dir}/.gitkeep`;
  if (!existsSync(join(root, dir))) write(keep, '');
}

console.log(`${dryRun ? '[dry-run] ' : ''}新建 ${created.length} 个文件:`);
for (const f of created) console.log('  +', f);
if (!cfg._path)
  console.log('  · 未找到项目配置,以上按默认路径落文件。先跑 task-package-orchestration 的 doctor.mjs --init --write 建 AGENTS.md frontmatter(非默认路径用 doc_* 字段)');
console.log('下一步: 填写总路线图「当前阶段」与排期页第0节,然后跑 check-doc-flow.mjs');
