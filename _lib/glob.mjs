// glob、白名单文件、泳道分类、git 改动面。三个 skill 共用,只依赖 Node 标准库。

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** glob → 正则:** 跨目录,* 不跨 /,? 单字符。 */
export function globToRegExp(glob) {
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

/** 编译一组 glob;返回 (path) => 命中的 glob 或 null。 */
export function matcher(globs) {
  const compiled = globs.map((g) => [g, globToRegExp(g)]);
  return (path) => compiled.find(([, re]) => re.test(path))?.[0] ?? null;
}

/** 白名单文件:每行一个 glob;# 注释;! 开头为黑名单。 */
export function readAllowFile(file) {
  const allow = [];
  const deny = [];
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('!')) deny.push(line.slice(1).trim());
    else allow.push(line);
  }
  return { allow, deny };
}

/** glob 第一个通配符之前的字面前缀。 */
export const literalPrefix = (glob) => glob.slice(0, glob.search(/[*?]/) === -1 ? glob.length : glob.search(/[*?]/));

/** 单段(不含 /)glob 是否可能匹配同一个名字:* 任意非 / 串,? 单字符。 */
function segmentMayOverlap(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1));
  dp[m][n] = 1;
  for (let i = m; i >= 0; i -= 1) {
    for (let j = n; j >= 0; j -= 1) {
      if (i === m && j === n) continue;
      let ok = 0;
      if (i < m && a[i] === '*') ok ||= dp[i + 1][j];
      if (j < n && b[j] === '*') ok ||= dp[i][j + 1];
      if (!ok && i < m && j < n) {
        if (a[i] === '*') ok = dp[i][j + 1] || dp[i + 1][j + 1];
        else if (b[j] === '*') ok = dp[i + 1][j] || dp[i + 1][j + 1];
        else if (a[i] === '?' || b[j] === '?' || a[i] === b[j]) ok = dp[i + 1][j + 1];
      }
      dp[i][j] = ok ? 1 : 0;
    }
  }
  return dp[0][0] === 1;
}

/** 从段首锚定比对两串路径段:前序实名段逐一相容后撞上 ** 即视为相交。 */
function anchoredSegsOverlap(sa, sb) {
  const len = Math.min(sa.length, sb.length);
  for (let i = 0; i < len; i += 1) {
    if (sa[i] === '**' || sb[i] === '**') return true;
    if (!segmentMayOverlap(sa[i], sb[i])) return false;
  }
  if (sa.length === sb.length) return true;
  const rest = sa.length > sb.length ? sa.slice(len) : sb.slice(len);
  return rest.every((s) => s === '**');
}

const stripLeadingGlobstar = (segs) => {
  let k = 0;
  while (k < segs.length && segs[k] === '**') k += 1;
  return segs.slice(k);
};

// 两个 glob 对「尚未存在的新建文件」是否可能相撞。
// 既覆盖固定前缀(db/migrations/new/** vs db/migrations/**),也覆盖 **/ 段模式
// (app/new/billing/** vs **/billing/**、services/x/Dockerfile.gpu vs **/Dockerfile*、**/*.test.ts vs tests/new/*.test.ts),
// 但不让泛目录(src/**)凭空被判进 **/billing/**。
export function prefixesOverlap(a, b) {
  const sa = a.split('/').filter(Boolean);
  const sb = b.split('/').filter(Boolean);
  if (!sa.length || !sb.length) return false;
  const aFloat = sa[0] === '**';
  const bFloat = sb[0] === '**';
  const ta = stripLeadingGlobstar(sa);
  const tb = stripLeadingGlobstar(sb);
  if (!ta.length || !tb.length) return true; // 纯 ** 覆盖全仓
  if (!aFloat && !bFloat) return anchoredSegsOverlap(sa, sb);
  const matchSuffix = (hay, needle) => {
    for (let k = 0; k < hay.length; k += 1) {
      if (hay[k] === '**') continue;
      if (anchoredSegsOverlap(hay.slice(k), needle)) return true;
    }
    return false;
  };
  return (bFloat && matchSuffix(ta, tb)) || (aFloat && matchSuffix(tb, ta));
}

export const LANES = ['contained', 'wide', 'closed', 'redline'];
export const LANE_LABEL = {
  contained: '局部可逆',
  wide: '可逆但面广',
  closed: '封死泳道',
  redline: '红线',
};

/** 按「撤回代价」给路径分道;命中多条时取最严的。cfg 为内部键配置。 */
export function laneClassifier(cfg) {
  const red = matcher(cfg.redline ?? []);
  const closed = matcher(cfg.closedLane ?? []);
  const wide = matcher(cfg.wideLane ?? []);
  return (path) => {
    let hit;
    if ((hit = red(path))) return { lane: 'redline', glob: hit };
    if ((hit = closed(path))) return { lane: 'closed', glob: hit };
    if ((hit = wide(path))) return { lane: 'wide', glob: hit };
    return { lane: 'contained', glob: null };
  };
}

export const worstLane = (lanes) => LANES[Math.max(0, ...lanes.map((l) => LANES.indexOf(l)))];

export function repoRoot(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error('当前目录不在 git 仓库里');
  }
}

const zlist = (root, ...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean);

export const trackedFiles = (root) => zlist(root, 'ls-files', '-z');

/** base 以来的改动面。加 --no-renames 防 git mv 把受保护旧路径折叠吞掉;head 为 HEAD 时含未提交与未跟踪。 */
export function changedSince(root, base, head = 'HEAD') {
  const changed = new Set(zlist(root, 'diff', '--no-renames', '--name-only', '-z', `${base}...${head}`));
  if (head === 'HEAD') {
    for (const p of zlist(root, 'diff', '--no-renames', '--name-only', '-z', 'HEAD')) changed.add(p);
    for (const p of zlist(root, 'ls-files', '--others', '--exclude-standard', '-z')) changed.add(p);
  }
  return [...changed].sort();
}

/** 极简参数解析:--k v 可重复;后面不跟值的是开关。 */
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set();
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        (opts[a.slice(2)] ??= []).push(next);
        i += 1;
      } else flags.add(a.slice(2));
    } else positional.push(a);
  }
  return { flags, opts, positional, one: (k) => opts[k]?.[0], all: (k) => opts[k] ?? [] };
}
