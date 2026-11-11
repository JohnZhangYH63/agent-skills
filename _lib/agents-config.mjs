// 项目配置的唯一入口。真源 = 仓库根 AGENTS.md 顶部的 frontmatter;三个 skill 的脚本都经这里读,
// 不各自解析、不各带默认红线。只依赖 Node 标准库(≥18)。
//
// frontmatter 是 YAML 的严格确定性子集:每行 `键: 值`(数组也可换行写 `[...]` 或 `- "项"` 列表),
// 字符串必须加双引号或单引号(兼容 Prettier 格式化后的单引号、换行 `[` 与尾逗号),整数裸写;
// `#` 开头的整行是注释,禁裸词与行尾注释。子集之外的写法、未知键、类型不对,一律带行号报错,不猜。
//
// 旧式 .docflow.json 仍可读(发 WARN 催迁移);两者并存时以 frontmatter 为准。

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const SUPPORTED_SCHEMA = 1;
export const CONFIG_FILE = 'AGENTS.md';
export const LEGACY_FILE = '.docflow.json';
export const SCHEMA_KEY = 'orchestrator_schema';

export class ConfigError extends Error {}

const str = (v) => typeof v === 'string' && v.trim() !== '';
const ref = (v) => str(v) && !v.startsWith('-');
const strs = (v) => Array.isArray(v) && v.every(str);
const someStrs = (v) => strs(v) && v.length > 0;
const posInt = (v) => Number.isInteger(v) && v > 0;

// [frontmatter 键, 内部键(旧 .docflow.json 也用这个名), 校验, 类型说明]
export const FIELDS = [
  [SCHEMA_KEY, 'schema', posInt, '正整数'],
  ['remote', 'remote', ref, '非空字符串'],
  ['main_branch', 'mainBranch', ref, '非空字符串'],
  ['check_cmds', 'checkCmds', strs, '字符串数组'],
  ['redline_globs', 'redline', strs, '字符串数组'],
  ['closed_lane_globs', 'closedLane', strs, '字符串数组'],
  ['wide_lane_globs', 'wideLane', strs, '字符串数组'],
  ['contract_doc', 'contractDoc', str, '非空字符串'],
  ['baseline_doc', 'baselineDoc', str, '非空字符串'],
  ['doc_roadmap', 'roadmap', str, '非空字符串'],
  ['doc_plan', 'plan', str, '非空字符串'],
  ['doc_decisions', 'decisions', str, '非空字符串'],
  ['doc_ledger', 'ledger', str, '非空字符串'],
  ['doc_index', 'index', str, '非空字符串'],
  ['doc_hot_dir', 'hotDir', str, '非空字符串'],
  ['doc_archive_dir', 'archiveDir', str, '非空字符串'],
  ['doc_managed', 'managed', someStrs, '非空的字符串数组'],
  ['doc_skip_dirs', 'skipDirs', strs, '字符串数组'],
  ['doc_next_marker', 'nextPackageMarker', str, '非空字符串'],
  ['doc_process_pattern', 'processDocPattern', str, '非空字符串'],
  ['doc_hot_limit', 'hotProcessLimit', posInt, '正整数'],
  ['doc_roadmap_max_bytes', 'roadmapMaxBytes', posInt, '正整数'],
];
const BY_FM = new Map(FIELDS.map((f) => [f[0], f]));
const BY_INTERNAL = new Map(FIELDS.map((f) => [f[1], f]));

/** 任务包编排脚本必须显式拿到的字段(内部键)。 */
export const CORE_KEYS = ['schema', 'remote', 'mainBranch', 'checkCmds', 'redline', 'closedLane'];

/** 拆出 frontmatter:返回 { lines, firstLine(1 起), bodyStart(正文首行下标) };没有则 null。 */
export function splitFrontmatter(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trimEnd() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
  if (end === -1) return null;
  return { lines: lines.slice(1, end), firstLine: 2, bodyStart: end + 1, all: lines };
}

const VALUE_HINT =
  '值必须是 JSON 字面量或兼容 YAML 子集(字符串加双/单引号,数组写 ["a", "b"] 可带尾逗号或换行 - "a",行尾不带注释)';

/** 解析单个标量(在 str 的 pos 处读一个带引号字符串或整数):返回 { ok, value, end }。 */
function scanScalar(str, pos = 0) {
  const n = str.length;
  while (pos < n && /\s/.test(str[pos])) pos += 1;
  if (pos >= n) return { ok: false };
  const ch = str[pos];
  if (ch === '"') {
    let p = pos + 1;
    while (p < n) {
      if (str[p] === '\\') p += 2;
      else if (str[p] === '"') {
        try {
          return { ok: true, value: JSON.parse(str.slice(pos, p + 1)), end: p + 1 };
        } catch {
          return { ok: false };
        }
      } else p += 1;
    }
    return { ok: false };
  }
  if (ch === "'") {
    let p = pos + 1;
    let out = '';
    while (p < n) {
      if (str[p] === "'" && str[p + 1] === "'") {
        out += "'";
        p += 2;
      } else if (str[p] === "'") return { ok: true, value: out, end: p + 1 };
      else {
        out += str[p];
        p += 1;
      }
    }
    return { ok: false };
  }
  const m = /^-?(?:0|[1-9]\d*)/.exec(str.slice(pos));
  if (m) return { ok: true, value: Number(m[0]), end: pos + m[0].length };
  return { ok: false };
}

function parseScalarExact(raw) {
  const r = scanScalar(raw, 0);
  if (!r.ok) return { ok: false };
  return raw.slice(r.end).trim() === '' ? { ok: true, value: r.value } : { ok: false };
}

/** 解析方括号数组(支持跨行、单双引号、末尾尾逗号;闭合 ] 后不许跟行尾注释)。status: 'ok' | 'incomplete' | 'invalid'。 */
function parseFlowArray(raw) {
  const s = raw.trimStart();
  if (!s.startsWith('[')) return { status: 'invalid' };
  const items = [];
  let p = 1;
  const skipWs = () => {
    while (p < s.length && /\s/.test(s[p])) p += 1;
  };
  skipWs();
  if (p >= s.length) return { status: 'incomplete' };
  if (s[p] === ']') return s.slice(p + 1).trim() === '' ? { status: 'ok', value: items } : { status: 'invalid' };
  while (p < s.length) {
    const elem = scanScalar(s, p);
    if (!elem.ok) {
      // 字符串跨过当前已拼接行尾(尚未闭合引号)时归为 incomplete?不:单条字符串禁止真换行,未闭合但到了行尾才可能是元素未写完
      return { status: 'invalid' };
    }
    items.push(elem.value);
    p = elem.end;
    skipWs();
    if (p >= s.length) return { status: 'incomplete' };
    if (s[p] === ',') {
      p += 1;
      skipWs();
      if (p >= s.length) return { status: 'incomplete' };
      if (s[p] === ']') return s.slice(p + 1).trim() === '' ? { status: 'ok', value: items } : { status: 'invalid' };
      continue;
    }
    if (s[p] === ']') return s.slice(p + 1).trim() === '' ? { status: 'ok', value: items } : { status: 'invalid' };
    return { status: 'invalid' };
  }
  return { status: 'incomplete' };
}

/** 解析 AGENTS.md 文本。不是我们的 frontmatter(没有 orchestrator_schema)返回 null;有错抛 ConfigError。 */
export function parseFrontmatter(text, file = CONFIG_FILE) {
  const fm = splitFrontmatter(text);
  if (!fm || !fm.lines.some((l) => new RegExp(`^${SCHEMA_KEY}\\s*:`).test(l))) return null;
  const values = {};
  const lineOf = {};
  const errors = [];
  const nextMeaningful = (from) => {
    for (let k = from; k < fm.lines.length; k += 1) {
      const t = fm.lines[k].trim();
      if (!t || t.startsWith('#')) continue;
      return { idx: k, trimmed: t };
    }
    return null;
  };
  for (let i = 0; i < fm.lines.length; i += 1) {
    const no = fm.firstLine + i;
    const line = fm.lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = /^([A-Za-z_]\w*)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      errors.push(`第 ${no} 行不是「键: 值」:${line.trim()}`);
      continue;
    }
    const [, key, first] = m;
    let raw = first.trim();
    let parsed;
    let ok = false;
    let itemErr = false;

    if (raw === '') {
      const peek = nextMeaningful(i + 1);
      if (peek && /^-\s+/.test(peek.trimmed)) {
        const list = [];
        let listOk = true;
        let j = i;
        while (j + 1 < fm.lines.length) {
          const next = nextMeaningful(j + 1);
          if (!next || !/^-\s+/.test(next.trimmed)) break;
          j = next.idx;
          const itemRaw = next.trimmed.replace(/^-\s+/, '').trim();
          const sc = parseScalarExact(itemRaw);
          if (!sc.ok) {
            errors.push(`第 ${fm.firstLine + j} 行 ${key}:${VALUE_HINT}`);
            listOk = false;
            itemErr = true;
          } else list.push(sc.value);
        }
        i = j;
        if (listOk) {
          parsed = list;
          ok = true;
        }
      } else if (peek && !/^[A-Za-z_]\w*\s*:/.test(fm.lines[peek.idx])) {
        raw = peek.trimmed;
        i = peek.idx;
      }
    }

    if (!ok && !itemErr) {
      if (raw.startsWith('[')) {
        let res = parseFlowArray(raw);
        let j = i;
        while (res.status === 'incomplete' && j + 1 < fm.lines.length && !/^[A-Za-z_]\w*\s*:/.test(fm.lines[j + 1])) {
          j += 1;
          if (!fm.lines[j].trim() || fm.lines[j].trim().startsWith('#')) continue;
          raw += `\n${fm.lines[j]}`;
          res = parseFlowArray(raw);
        }
        if (res.status === 'ok') {
          parsed = res.value;
          ok = true;
          i = j;
        }
      } else if (raw !== '') {
        const sc = parseScalarExact(raw);
        if (sc.ok) {
          parsed = sc.value;
          ok = true;
        }
      }
    }

    if (itemErr) continue;
    if (!ok) {
      errors.push(`第 ${no} 行 ${key}:${VALUE_HINT}`);
      continue;
    }
    const field = BY_FM.get(key);
    if (!field) {
      errors.push(`第 ${no} 行:未知字段 ${key}(字段表见 task-package-orchestration/references/project-config.md)`);
      continue;
    }
    if (key in lineOf) {
      errors.push(`第 ${no} 行:${key} 重复(首次在第 ${lineOf[key]} 行)`);
      continue;
    }
    lineOf[key] = no;
    if (!field[2](parsed)) {
      errors.push(`第 ${no} 行 ${key}:应为${field[3]}`);
      continue;
    }
    values[field[1]] = parsed;
  }
  if (errors.length) throw new ConfigError(`${file} 的 frontmatter 有误:\n  - ${errors.join('\n  - ')}`);
  if (values.schema > SUPPORTED_SCHEMA)
    throw new ConfigError(
      `${file} 要求 ${SCHEMA_KEY} ${values.schema},本机 skill 只支持到 ${SUPPORTED_SCHEMA}:先更新 agent-skills 仓库(git pull)。`,
    );
  return { values, lineOf, bodyStart: fm.bodyStart, bodyLines: fm.all.slice(fm.bodyStart) };
}

/** 内部键 → frontmatter 文本(固定字段顺序;长数组分行)。 */
export function renderFrontmatter(values, comments = {}) {
  const out = ['---'];
  for (const [fmKey, key] of FIELDS) {
    if (values[key] === undefined) continue;
    for (const c of comments[key] ?? []) out.push(`# ${c}`);
    const v = values[key];
    const flat = JSON.stringify(v);
    if (Array.isArray(v) && v.length > 1 && flat.length > 72)
      out.push(`${fmKey}: [`, ...v.map((x, i) => `  ${JSON.stringify(x)}${i < v.length - 1 ? ',' : ''}`), '  ]');
    else out.push(`${fmKey}: ${Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(', ')}]` : flat}`);
  }
  out.push('---');
  return out.join('\n');
}

function result(source, path, values, warnings) {
  const keyName = (k) => (source === 'legacy-json' ? k : (BY_INTERNAL.get(k)?.[0] ?? k));
  return {
    source,
    path,
    values,
    warnings,
    keyName,
    /** 要求这些内部键已显式配置;缺配置或缺字段都抛 ConfigError,不给默认值。 */
    need(...keys) {
      if (!source)
        throw new ConfigError(
          `缺少配置 ${path}:在仓库根 ${CONFIG_FILE} 顶部写 frontmatter(task-package-orchestration 的 doctor.mjs --init 出草稿),` +
            `或用 --config 指定。不会猜测远端,也不会按空红线继续。`,
        );
      const missing = keys.filter((k) => values[k] === undefined);
      if (missing.length)
        throw new ConfigError(
          `配置 ${path} 必须显式填写 ${missing.map(keyName).join('、')}` +
            (source === 'legacy-json' ? `(旧式 ${LEGACY_FILE};建议 doctor.mjs --init 迁到 ${CONFIG_FILE} frontmatter)` : '') +
            `;确实没有时数组写 []。`,
        );
      return values;
    },
  };
}

function fromJson(path, warnings) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(`无法读取配置 ${path}:${error.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError(`配置 ${path} 必须是 JSON 对象。`);
  const values = {};
  const errors = [];
  for (const [, key, valid, kind] of FIELDS) {
    if (raw[key] === undefined) continue;
    if (!valid(raw[key])) errors.push(`${key} 应为${kind}`);
    else values[key] = raw[key];
  }
  if (errors.length) throw new ConfigError(`配置 ${path} 有误:${errors.join(';')}。`);
  return result('legacy-json', path, values, warnings);
}

function fromMarkdown(path, warnings) {
  const parsed = parseFrontmatter(readFileSync(path, 'utf8'), path);
  if (!parsed) throw new ConfigError(`${path} 顶部没有带 ${SCHEMA_KEY} 的 frontmatter。`);
  return Object.assign(result('frontmatter', path, parsed.values, warnings), { lineOf: parsed.lineOf, bodyLines: parsed.bodyLines });
}

/**
 * 读项目配置。explicitPath(--config)优先:.json 按旧式读,其余按带 frontmatter 的 Markdown 读。
 * 否则:AGENTS.md frontmatter → 旧式 .docflow.json(WARN)→ source=null(由调用方 need() 时报缺)。
 */
export function loadProjectConfig(root, explicitPath) {
  const warnings = [];
  if (explicitPath) {
    const p = resolve(explicitPath);
    if (!existsSync(p)) return result(null, p, {}, warnings);
    return p.endsWith('.json') ? fromJson(p, warnings) : fromMarkdown(p, warnings);
  }
  const agents = join(root, CONFIG_FILE);
  const legacy = join(root, LEGACY_FILE);
  if (existsSync(agents) && parseFrontmatter(readFileSync(agents, 'utf8'), agents)) {
    if (existsSync(legacy))
      warnings.push(`${LEGACY_FILE} 与 ${CONFIG_FILE} frontmatter 并存:只认 frontmatter,请删掉 ${LEGACY_FILE}(第二份真源会漂移)。`);
    return fromMarkdown(agents, warnings);
  }
  if (existsSync(legacy)) {
    warnings.push(`正在用旧式 ${LEGACY_FILE}:跑 task-package-orchestration 的 doctor.mjs --init 迁到 ${CONFIG_FILE} frontmatter。`);
    return fromJson(legacy, warnings);
  }
  return result(null, agents, {}, warnings);
}

export function printWarnings(cfg) {
  for (const w of cfg.warnings) console.error(`WARN  ${w}`);
}

/** 脚本入口用:把 ConfigError 变成 stderr + 退出码 2,其余异常照抛。 */
export function exitOnConfigError(fn) {
  try {
    return fn();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    process.exit(2);
  }
}
