#!/usr/bin/env node
// 给一个仓库铺好文档流转骨架:.docflow.json + 总路线图/排期页/决策页/台账/索引(+ 缺失时的 AGENTS.md)
// + 热区与冷区目录。只创建不存在的文件,从不覆盖。
// 用法: node docflow-init.mjs --name <项目名> [--config <path>] [--dry-run]
//   已有 .docflow.json 就按它的路径落文件;没有就用默认路径写一份(remote 自动取 origin 或第一个远端)。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { parseArgs, repoRootFrom, loadConfig, tryGit, DEFAULT_CONFIG, relativeLink } from './docflow-lib.mjs';

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

// .docflow.json
if (!cfg._path) {
  const remotes = (tryGit(root, 'remote') ?? '').split('\n').filter(Boolean);
  const remote = remotes.includes('origin') ? 'origin' : (remotes[0] ?? 'origin');
  const head = tryGit(root, 'symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`);
  const mainBranch = head ? head.split('/').slice(1).join('/') : DEFAULT_CONFIG.mainBranch;
  const { _path, ...rest } = { ...cfg, remote, mainBranch };
  write('.docflow.json', JSON.stringify(rest, null, 2) + '\n');
  Object.assign(cfg, { remote, mainBranch });
}

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
  ['agents', 'AGENTS.md'],
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
if (existsSync(join(root, 'AGENTS.md')) && !created.includes('AGENTS.md'))
  console.log('  · AGENTS.md 已存在,未改动:请对照模板补「角色/读序/红线/交付底线」四节');
console.log('下一步: 填写总路线图「当前阶段」与排期页第0节,然后跑 check-doc-flow.mjs');
