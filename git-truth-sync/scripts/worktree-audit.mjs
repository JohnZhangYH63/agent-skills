#!/usr/bin/env node
// 盘点所有 worktree:独有提交(不在远端主分支)、是否已在任一远端分支、未提交改动数、是否放在仓库目录内。
// 默认只读。--remove-safe 只删除「独有=0 且 脏=0 且 不是当前检出」的 worktree(分支保留)。
// 用法: node worktree-audit.mjs [--remove-safe]

import { git, tryGit, loadConfig, opts, root } from './gts-lib.mjs';

const { flags, o } = opts();
const cfg = loadConfig(o.config);
const remoteMain = `${cfg.remote}/${cfg.mainBranch}`;
tryGit('fetch', '-q', cfg.remote);
const blocks = git('worktree', 'list', '--porcelain').split('\n\n').filter(Boolean);
const rows = [];
for (const b of blocks) {
  const get = (k) => b.split('\n').find((l) => l.startsWith(k + ' '))?.slice(k.length + 1);
  const path = get('worktree');
  const head = get('HEAD');
  const branch = get('branch')?.replace('refs/heads/', '') ?? '(detached)';
  if (!path || path === root) continue;
  const unique = Number(tryGit('rev-list', '--count', `${remoteMain}..${head}`) ?? NaN);
  const onRemote = (tryGit('branch', '-r', '--contains', head) ?? '').split('\n').filter(Boolean).length;
  const dirty = (tryGit('-C', path, 'status', '--porcelain') ?? '').split('\n').filter(Boolean).length;
  const inRepo = path.startsWith(root + '/');
  const safe = unique === 0 && dirty === 0;
  rows.push({ path, branch, unique, onRemote, dirty, inRepo, safe });
}
for (const r of rows)
  console.log(`${r.safe ? '可清' : '保留'} 独有=${r.unique} 远端含=${r.onRemote} 脏=${r.dirty}${r.inRepo ? ' ⚠仓库内' : ''} ${r.branch} | ${r.path}`);
const unpushed = rows.filter((r) => r.unique > 0 && r.onRemote === 0 && r.branch !== '(detached)');
if (unpushed.length) console.log(`\n独有提交只在本机的分支(建议先推远端备份):\n  ${unpushed.map((r) => r.branch).join('\n  ')}`);
if (flags.has('remove-safe')) {
  for (const r of rows.filter((x) => x.safe)) {
    const ok = tryGit('worktree', 'remove', r.path) !== null;
    console.log(`${ok ? '已清' : '拒绝删除'} ${r.path}`);
  }
  tryGit('worktree', 'prune');
}
