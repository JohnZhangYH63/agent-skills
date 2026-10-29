// git-truth-sync 共用:仓库根、配置、git 调用、符号链接感知的"工作区文件 vs 某个 ref"比对。

import { readFileSync, existsSync, lstatSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

export const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

export function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
}
export function gitEnv(env, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 1 << 28 }).trim();
}
export function tryGit(...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function loadConfig(path) {
  const p = path ?? join(root, '.docflow.json');
  const cfg = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
  return {
    remote: cfg.remote ?? 'origin',
    mainBranch: cfg.mainBranch ?? 'main',
    docPaths: (cfg.managed ?? ['docs', '.agents', '*.md']).filter((m) => m !== '*.md'),
    rootMarkdown: (cfg.managed ?? ['*.md']).includes('*.md'),
  };
}

export function opts(argv = process.argv.slice(2)) {
  const o = {};
  const flags = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) o[k] = argv[(i += 1)];
    else flags.add(k);
  }
  return { o, flags };
}

/** ref 里某路径的 { mode, blob };不存在返回 null。一次性取整棵树,避免逐文件起进程。 */
export function treeIndex(ref) {
  const out = execFileSync('git', ['ls-tree', '-r', '-z', ref], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  const map = new Map();
  for (const e of out.split('\0')) {
    if (!e) continue;
    const [meta, path] = e.split('\t');
    const [mode, , blob] = meta.split(' ');
    map.set(path, { mode, blob });
  }
  return map;
}

/** 工作区路径的身份:普通文件 = git hash-object;符号链接 = 链接目标字符串的 blob(与 git 存法一致)。 */
export function worktreeIds(paths) {
  const ids = new Map();
  const regular = [];
  for (const p of paths) {
    const abs = join(root, p);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      ids.set(p, null);
      continue;
    }
    if (st.isSymbolicLink()) {
      const target = readlinkSync(abs);
      ids.set(p, { mode: '120000', blob: execFileSync('git', ['hash-object', '--stdin'], { cwd: root, input: target, encoding: 'utf8' }).trim() });
    } else regular.push(p);
  }
  // hash-object 对普通文件逐个算;分批避免参数过长
  for (let i = 0; i < regular.length; i += 500) {
    const batch = regular.slice(i, i + 500);
    const hashes = execFileSync('git', ['hash-object', '--stdin-paths'], { cwd: root, input: batch.join('\n'), encoding: 'utf8', maxBuffer: 1 << 28 })
      .trim()
      .split('\n');
    batch.forEach((p, j) => ids.set(p, { mode: 'file', blob: hashes[j] }));
  }
  return ids;
}

export function sameAs(id, entry) {
  if (!id || !entry) return id === null && entry == null;
  if (id.mode === '120000' || entry.mode === '120000') return id.mode === entry.mode && id.blob === entry.blob;
  return id.blob === entry.blob;
}

export const isDocPath = (cfg, p) =>
  cfg.docPaths.some((d) => p === d || p.startsWith(`${d}/`)) || (cfg.rootMarkdown && !p.includes('/') && p.endsWith('.md'));
