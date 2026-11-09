# `.docflow.json` 字段

放在仓库根。三个 skill 的脚本共用。下表是文档初始化的默认值（见 `scripts/docflow-lib.mjs` 的 `DEFAULT_CONFIG`），不代表可以省略运行时的安全配置：Git 同步脚本要求显式提供 `remote`、`mainBranch`、`managed`；通用白名单脚本要求显式提供 `redline` 数组，确无红线才写 `[]`。缺文件或缺这些字段时停止，不猜测远端或按空红线继续。已有项目优先使用仓内脚本；需要外部配置时传 `--config <json>`。

| 字段 | 含义 | 默认 |
|---|---|---|
| `roadmap` | 总路线图（路由器） | `docs/总路线图.md` |
| `plan` | 排期页，可带一个 `*`（如 `work/后续工程总计划-*.md`），必须恰好匹配 1 份 | `docs/work/后续工程总计划.md` |
| `decisions` | 现行决策页，可带 `*` | `docs/work/现行决策.md` |
| `ledger` / `index` | 完成台账 / 文档索引 | `docs/完成台账.md` / `docs/索引.md` |
| `hotDir` | 热区：新文档、任务包报告写这里；其根部过程稿受上限约束 | `docs/work` |
| `archiveDir` | 冷区根，每批一个 `<日期>/` 子目录 | `docs/work/archive` |
| `managed` | 受管 Markdown：目录递归；`"*.md"` = 仓库根的 md | `["docs", ".agents", "*.md"]` |
| `skipDirs` | 递归时跳过的目录名（原始证据目录放这里，转冷不搬它） | `evidence`, `node_modules`, … |
| `nextPackageMarker` | 排期页里唯一下一包那一行的开头 | `**唯一下一包**` |
| `processDocPattern` | 判定“过程稿”的文件名正则 | 冻结/交付/审核/实现报告/… |
| `hotProcessLimit` | 热区根部过程稿上限，超了门禁报错 | `20` |
| `roadmapMaxBytes` | 总路线图体量上限 | `8192` |
| `remote` / `mainBranch` | 唯一真源远端与主分支 | `origin` / `main` |
| `redline` | 任何任务包都不许改的 glob（白名单检查恒为黑名单） | `[]` |

完整示例：`examples/sample.docflow.json`。本机私有项目的配置可放 `examples/<名>.local.json`（已被 .gitignore 排除）。
