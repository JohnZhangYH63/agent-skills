# 文档流转配置（`AGENTS.md` frontmatter 的 `doc_*` 字段）

项目配置只有一处：仓库根 `AGENTS.md` 顶部的 frontmatter。写法、必填字段和红线/泳道字段见 `task-package-orchestration/references/project-config.md`；这里只列文档流转用的字段。全部可省略，省略时取默认值。例外：Git 同步脚本（`git-truth-sync`）要求显式提供 `remote`、`main_branch`、`doc_managed`，缺了就停，不猜远端。

| 字段 | 含义 | 默认 |
|---|---|---|
| `doc_roadmap` | 总路线图（路由器） | `docs/总路线图.md` |
| `doc_plan` | 排期页，可带一个 `*`，必须恰好匹配 1 份 | `docs/work/后续工程总计划.md` |
| `doc_decisions` | 现行决策页，可带 `*` | `docs/work/现行决策.md` |
| `doc_ledger` / `doc_index` | 完成台账 / 文档索引 | `docs/完成台账.md` / `docs/索引.md` |
| `doc_hot_dir` | 热区：新文档、任务包报告写这里；其根部过程稿受上限约束 | `docs/work` |
| `doc_archive_dir` | 冷区根，每批一个 `<日期>/` 子目录 | `docs/work/archive` |
| `doc_managed` | 受管 Markdown：目录递归；`"*.md"` = 仓库根的 md | `["docs", ".agents", "*.md"]` |
| `doc_skip_dirs` | 递归时跳过的目录名（原始证据目录放这里，转冷不搬它） | `evidence`, `node_modules`, … |
| `doc_next_marker` | 排期页里唯一下一包那一行的开头 | `**唯一下一包**` |
| `doc_process_pattern` | 判定“过程稿”的文件名正则 | 冻结/交付/审核/实现报告/… |
| `doc_hot_limit` | 热区根部过程稿上限，超了门禁报错 | `20` |
| `doc_roadmap_max_bytes` | 总路线图体量上限 | `8192` |

旧式 `.docflow.json` 仍可读但会告警；迁移用 `task-package-orchestration/scripts/doctor.mjs --init --write`。
