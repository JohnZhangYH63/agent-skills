#!/usr/bin/env node
// 把当前工作区完整状态(已跟踪改动 + 未跟踪文件,遵守 .gitignore)存成一个本地分支,
// 不碰工作区、不碰真 index、不用 stash。用于任何"可能丢东西"的操作之前。
// 用法: node snapshot.mjs [--name <分支名>] [--verify <分支名>]
//   --verify: 只比对当前工作区与已有快照是否完全一致(前移前复核"快照后没人动过")。

import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, gitEnv, opts } from './gts-lib.mjs';

const { o } = opts();
const idx = join(tmpdir(), `gts-snap-${process.pid}.idx`);
function worktreeTree() {
  const env = { GIT_INDEX_FILE: idx };
  try {
    gitEnv(env, 'read-tree', 'HEAD');
    gitEnv(env, 'add', '-A', '.');
    return gitEnv(env, 'write-tree');
  } finally {
    rmSync(idx, { force: true });
  }
}

if (o.verify) {
  const now = worktreeTree();
  const snap = git('rev-parse', `${o.verify}^{tree}`);
  console.log(now === snap ? `✓ 工作区与快照 ${o.verify} 完全一致` : `✗ 工作区自快照后有变化(现在 ${now.slice(0, 10)} ≠ 快照 ${snap.slice(0, 10)}),停下核对`);
  process.exit(now === snap ? 0 : 1);
}

const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const name = o.name ?? `snapshot/worktree-${date}`;
const tree = worktreeTree();
const head = git('rev-parse', 'HEAD');
const commit = git('commit-tree', tree, '-p', head, '-m', `snapshot: 工作区全量快照(含全部未提交/未跟踪,基于 ${head.slice(0, 10)})`);
git('branch', name, commit);
const stat = git('diff', '--shortstat', head, commit);
console.log(`✓ 快照分支 ${name} = ${commit.slice(0, 10)}(相对 HEAD: ${stat || '无差异'})`);
console.log('  只留本地,别推(可能含大文件与私有素材)。恢复单个文件: git checkout <快照分支> -- <路径>');
