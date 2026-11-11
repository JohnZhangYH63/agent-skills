# 项目配置：`AGENTS.md` frontmatter

每个仓库只有这一处机器可读配置。三个 skill（`task-package-orchestration`、`project-doc-flow`、`git-truth-sync`）的脚本都经 `_lib/agents-config.mjs` 读它。

## 写法（YAML 的确定性子集，兼容 Prettier 格式化）

- 文件第一行 `---`，到下一行 `---` 结束；每行 `键: 值`。
- 字符串加双引号或单引号（`"a"` / `'a'`，禁裸词），整数裸写；数组可同行或跨行写 `["a", "b"]`（允许键后换行再起 `[` 及末尾尾逗号），也可写 YAML 列表 `- "a"`。`#` 开头的整行是注释，行尾不带注释。
- 未知键、类型不对、子集之外的写法都带行号报错。脚本不猜、不给红线默认值。

```yaml
---
orchestrator_schema: 1
remote: "origin"
main_branch: "main"
check_cmds: ["pnpm lint", "pnpm test"]
redline_globs: ["AGENTS.md", "docs/source/**"]
closed_lane_globs: ["db/migrations/**", "**/payment/**", "deploy/**"]
wide_lane_globs: ["package.json", "src/shared/**"]
contract_doc: "docs/spec/05-共享接口契约.md"
doc_managed: ["docs", "*.md"]
---
```

## 字段

| 字段 | 必填 | 含义 |
|---|---|---|
| `orchestrator_schema` | 是 | 配置版本，当前 `1`。高于本机 skill 支持的版本时脚本拒绝运行并提示更新 skill 仓库 |
| `remote` / `main_branch` | 是 | 唯一真源的远端与主分支；任务包 base 从这里取。尚未建立远端的纯本地仓填保留字 `remote: "local"`（一旦仓库存在任何 git remote，填 `"local"` 直接报错） |
| `check_cmds` | 是 | 能判败的验收命令，`gate-run.mjs` 逐条执行并分别记退出码。没有就写 `[]`（doctor 会告警） |
| `redline_globs` | 是 | 任何任务包都不许改；白名单机检恒为黑名单。建议含 `AGENTS.md` 自身 |
| `closed_lane_globs` | 是 | 封死泳道：迁移、钱账、生产数据、部署。不自动过闸 |
| `wide_lane_globs` | 否 | 可逆但面广：依赖清单、公共工具、共享 schema |
| `contract_doc` | 否 | 跨模块共享接口契约的位置 |
| `baseline_doc` | 否 | 环境与已知基线红的备忘位置 |
| `doc_managed` | git-truth-sync 必填 | 受管文档路径；`"*.md"` = 仓库根的 md |
| `doc_roadmap` `doc_plan` `doc_decisions` `doc_ledger` `doc_index` `doc_hot_dir` `doc_archive_dir` `doc_skip_dirs` `doc_next_marker` `doc_process_pattern` `doc_hot_limit` `doc_roadmap_max_bytes` | 否 | 文档流转用，含义与默认值见 `project-doc-flow/references/config.md` |

glob：`**` 跨目录，`*` 不跨 `/`，`?` 单字符。一个路径命中多条泳道时取最严的（redline > closed > wide > contained）。

## 谁能改

- 收紧：编排者直接改并在交付里说明。
- 放松：owner 明确同意后才改，提交信息写明原话与日期。
- 执行者不改；`AGENTS.md` 建议列入 `redline_globs`，由机检保证。

## 正文留什么

frontmatter 之外只留三类：角色与读序（模板里那几行）、glob 表达不了的红线、项目事实与切包约束。流程不抄进来，以全局 skill 为准。模板见 [AGENTS.template.md](AGENTS.template.md)。`CLAUDE.md`、`GEMINI.md` 等只写一行指向 `AGENTS.md`。

## 旧式 `.docflow.json`

仍可读，但每次运行会告警，`doctor.mjs` 判为 ERROR。迁移：`doctor.mjs --init`（看草稿）→ `--init --write` → 核对 → `git rm .docflow.json`。

## 升级说明

- schema 1：首版。
