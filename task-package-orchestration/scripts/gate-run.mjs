#!/usr/bin/env node
// 闸门运行器:逐条执行 AGENTS.md frontmatter 的 check_cmds,把每条的退出码、耗时、完整输出落盘,
// 给审核一份不依赖执行者自述的原始证据。在被审仓库/worktree 内执行。
// 用法:
//   node gate-run.mjs [--out <目录>]                       跑一遍,写 <目录>/gate.json 与逐条日志
//   node gate-run.mjs --baseline <base 上跑出的 gate.json>   与基线对照,区分「新增红」与「基线红」
//   --only <序号,从1起>(可重复)  --timeout <秒,每条,默认 1800>  --config <path>
// 退出码: 0 全绿;1 有新增红(或无基线时有红);3 只剩基线红(需人工对照原始数字,证明没有恶化);2 配置/参数问题。
// 「没有报错」不等于正确:这里只证明这些命令的结果,合同的行为验收仍要单独做。

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { loadProjectConfig, printWarnings, exitOnConfigError } from '../../_lib/agents-config.mjs';
import { parseArgs, repoRoot } from '../../_lib/glob.mjs';

const args = parseArgs();
const root = repoRoot();
const project = exitOnConfigError(() => {
  const p = loadProjectConfig(root, args.one('config'));
  p.need('checkCmds');
  return p;
});
printWarnings(project);
const cmds = project.values.checkCmds;
if (cmds.length === 0) {
  console.error(`${project.keyName('checkCmds')} 为空:没有可机检的闸门。没有能判败的检查就不算闸门,先补验收命令。`);
  process.exit(2);
}
const only = args.all('only').map(Number);
const timeout = Number(args.one('timeout') ?? 1800) * 1000;
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain').length > 0;
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const out = resolve(args.one('out') ?? join(tmpdir(), `gate-${head.slice(0, 10)}-${stamp}`));
mkdirSync(out, { recursive: true });

let baseline = null;
if (args.one('baseline')) {
  try {
    baseline = JSON.parse(readFileSync(args.one('baseline'), 'utf8'));
  } catch (error) {
    console.error(`读不了基线 ${args.one('baseline')}:${error.message}`);
    process.exit(2);
  }
}

const results = [];
cmds.forEach((cmd, i) => {
  if (only.length && !only.includes(i + 1)) return;
  const log = join(out, `${String(i + 1).padStart(2, '0')}.log`);
  const started = Date.now();
  const r = spawnSync(`${cmd} 2>&1`, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 1 << 28, timeout });
  const exit = r.error?.code === 'ETIMEDOUT' || r.signal ? 'timeout' : (r.status ?? 'error');
  const text = (r.stdout ?? '') + (r.error && exit === 'error' ? `\n${r.error.message}` : '');
  writeFileSync(log, text);
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const before = baseline?.results?.find((b) => b.cmd === cmd);
  const status = exit === 0 ? 'green' : before && before.exit !== 0 ? 'baseline-red' : 'new-red';
  results.push({ cmd, exit, seconds, log, status, baselineExit: before?.exit ?? null });
  console.log(`${exit === 0 ? '  ✓' : '  ✗'} [${i + 1}] ${cmd}  → exit ${exit}  (${seconds}s)${status === 'baseline-red' ? '  基线同为红' : ''}`);
  if (exit !== 0) for (const line of text.trimEnd().split('\n').slice(-12)) console.log(`      ${line}`);
});

const record = { head, dirty, root, startedAt: stamp, baselineHead: baseline?.head ?? null, results };
writeFileSync(join(out, 'gate.json'), JSON.stringify(record, null, 2) + '\n');
const newRed = results.filter((r) => r.status === 'new-red');
const baseRed = results.filter((r) => r.status === 'baseline-red');
console.log(
  `闸门 ${results.length} 条:绿 ${results.length - newRed.length - baseRed.length} / 新增红 ${newRed.length} / 基线红 ${baseRed.length}` +
    `(HEAD ${head.slice(0, 10)}${dirty ? ',工作区有未提交改动' : ''}${baseline ? `;基线 ${String(baseline.head).slice(0, 10)}` : ';无基线'})`,
);
console.log(`证据:${join(out, 'gate.json')}`);
if (baseRed.length) console.log('  ! 基线红不算通过:打开两边日志对照原始失败数,写进审核记录的「基线对照」,证明没有恶化。');
process.exit(newRed.length ? 1 : baseRed.length ? 3 : 0);
