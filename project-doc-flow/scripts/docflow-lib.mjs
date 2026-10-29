// project-doc-flow 共用库:定位仓库、读 .docflow.json、收集受管 Markdown、解析/改写相对链接。
// 只依赖 Node 标准库(≥18)。所有脚本以「当前工作目录所在的 git 仓库」为对象。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

export const DEFAULT_CONFIG = {
  roadmap: 'docs/总路线图.md',
  plan: 'docs/work/后续工程总计划.md',
  decisions: 'docs/work/现行决策.md',
  ledger: 'docs/完成台账.md',
  index: 'docs/索引.md',
  hotDir: 'docs/work',
  archiveDir: 'docs/work/archive',
  managed: ['docs', '.agents', '*.md'],
  skipDirs: ['evidence', 'node_modules', '.git', '.next', 'dist', 'build'],
  nextPackageMarker: '**唯一下一包**',
  processDocPattern: '(冻结|交付|审核|实现报告|勘察|ROOT结论|freeze|delivery|review)',
  hotProcessLimit: 20,
  roadmapMaxBytes: 8192,
  remote: 'origin',
  mainBranch: 'main',
  redline: [],
};

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
  return { flags, opts, positional, one: (k) => opts[k]?.[0] };
}

export function repoRootFrom(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    throw new Error('当前目录不在 git 仓库里');
  }
}

/** 读配置:--config 指定优先,否则仓库根 .docflow.json,缺省字段取默认值。 */
export function loadConfig(root, configPath) {
  const p = configPath ? resolve(configPath) : join(root, '.docflow.json');
  const user = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
  return { ...DEFAULT_CONFIG, ...user, _path: existsSync(p) ? p : null };
}

export function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}
export function tryGit(root, ...args) {
  try {
    return git(root, ...args);
  } catch {
    return null;
  }
}

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

/** 解析一个可能带通配的单文件配置项(如 plan: "work/后续工程总计划-*.md"),返回匹配到的仓库相对路径数组。 */
export function resolveSingle(root, pattern) {
  if (!/[*?]/.test(pattern)) return existsSync(join(root, pattern)) ? [pattern] : [];
  const dir = dirname(pattern);
  const re = globToRegExp(basename(pattern));
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir))
    .filter((n) => re.test(n))
    .map((n) => (dir === '.' ? n : `${dir}/${n}`));
}

function walk(dir, skip, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!skip.has(name)) walk(p, skip, out);
    } else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** 受管 Markdown 绝对路径:config.managed 里的目录递归,"*.md" 表示仓库根的 md。 */
export function collectManagedMarkdown(root, config) {
  const skip = new Set(config.skipDirs);
  const files = [];
  for (const entry of config.managed) {
    if (entry === '*.md') {
      for (const name of readdirSync(root))
        if (name.endsWith('.md') && statSync(join(root, name)).isFile()) files.push(join(root, name));
      continue;
    }
    const abs = join(root, entry);
    if (existsSync(abs) && statSync(abs).isDirectory()) walk(abs, skip, files);
  }
  return [...new Set(files)];
}

// 只认行内链接 [text](target) / ![alt](target);锚点与任何 scheme(https/mailto/…)不管。
const LINK_RE = /\]\(([^)\s]+)\)/g;
const FILE_EXT_RE = /\.(md|html|svg|png|jpe?g|webp|gif|mjs|cjs|js|json|ya?ml|tsx?|css|log|sql|pdf|txt|diff|gz)$/i;

export function isFileLikeTarget(target) {
  if (/^#/.test(target) || /^[a-z][a-z0-9+.-]*:/i.test(target)) return false;
  const path = target.split('#')[0];
  return path !== '' && (path.includes('/') || FILE_EXT_RE.test(path));
}

export function resolveTarget(root, fromFile, target) {
  const path = decodeURIComponent(target.split('#')[0]);
  return path.startsWith(sep) ? join(root, path) : resolve(dirname(fromFile), path);
}

export function relativeLink(fromFile, absTarget, originalTarget) {
  const rel = relative(dirname(fromFile), absTarget).split(sep).join('/');
  const hash = originalTarget.includes('#') ? originalTarget.slice(originalTarget.indexOf('#')) : '';
  return rel + hash;
}

export function rewriteLinks(text, fn) {
  return text.replace(LINK_RE, (whole, target) => {
    if (!isFileLikeTarget(target)) return whole;
    const next = fn(target);
    return next && next !== target ? `](${next})` : whole;
  });
}

export function listLinks(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(LINK_RE)) if (isFileLikeTarget(m[1])) out.push({ line: i + 1, target: m[1] });
  });
  return out;
}

export const toRepoPath = (root, abs) => relative(root, abs).split(sep).join('/');
