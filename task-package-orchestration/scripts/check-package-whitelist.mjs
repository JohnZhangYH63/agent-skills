#!/usr/bin/env node
// 任务包白名单检查(审核必跑,在被审仓库/worktree 内执行):列出 base 以来的全部改动
// (已提交 + 工作区未提交 + 未跟踪),逐个对照冻结合同的白名单/黑名单。白名单外或命中黑名单 → 退出码 1。
// 仓库根 .docflow.json 的 redline 恒为黑名单(除非合同显式授权并传 --allow-redline)。
// 用法:
//   node check-package-whitelist.mjs --base <SHA> --allow 'src/foo/**' --allow 'tests/foo/*.test.ts' [--deny 'x/**'] [--head <ref>]
//   node check-package-whitelist.mjs --base <SHA> --allow-file <白名单文件>   # 每行一个 glob;# 注释;! 开头为黑名单
// glob: ** 跨目录, * 不跨 /, ? 单字符。

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = (name) => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []));
const base = opt('--base')[0];
const head = opt('--head')[0] ?? 'HEAD';
if (!base) {
  console.error('缺 --base <SHA>(取冻结合同里的“当前 base SHA”)');
  process.exit(2);
}
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });

const allow = [...opt('--allow')];
const deny = [...opt('--deny')];
for (const file of opt('--allow-file')) {
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('!')) deny.push(line.slice(1).trim());
    else allow.push(line);
  }
}
const cfgPath = opt('--config')[0] ?? join(root, '.docflow.json');
const redline = existsSync(cfgPath) ? (JSON.parse(readFileSync(cfgPath, 'utf8')).redline ?? []) : [];
if (!argv.includes('--allow-redline')) deny.push(...redline);
if (allow.length === 0) {
  console.error('白名单为空:用 --allow 或 --allow-file 给出合同白名单');
  process.exit(2);
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
const allowRe = allow.map(globToRegExp);
const denyRe = deny.map((g) => [g, globToRegExp(g)]);

const changed = new Set();
const add = (out) => out.split('\0').forEach((p) => p && changed.add(p));
add(git('diff', '--name-only', '-z', `${base}...${head}`));
if (head === 'HEAD') {
  // 未提交与未跟踪也是交付面:执行者忘提交的改动同样越界
  add(git('diff', '--name-only', '-z', 'HEAD'));
  add(git('ls-files', '--others', '--exclude-standard', '-z'));
}

const bad = [];
for (const path of [...changed].sort()) {
  const hit = denyRe.find(([, re]) => re.test(path));
  const ok = !hit && allowRe.some((re) => re.test(path));
  console.log(`${ok ? '  ✓' : '  ✗'} ${path}${hit ? `  (黑名单 ${hit[0]})` : ok ? '' : '  (白名单外)'}`);
  if (!ok) bad.push(path);
}
console.log(`改动 ${changed.size} 个文件,越界 ${bad.length} 个(base ${base.slice(0, 10)}…${head};红线 ${redline.length} 条)`);
process.exit(bad.length ? 1 : 0);
