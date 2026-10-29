---
name: project-doc-flow
description: 项目文档流转体系——总路线图当路由器、排期页第0节只写一行「唯一下一包」、现行决策页、完成台账、热区/冷区与关账转冷，配套文档流转门、转冷脚本和新项目初始化。用于：新项目铺文档骨架；问“项目进行到哪/下一步做什么/去哪看”；关账、新计划开始、写完任务包报告、改导航之后的收尾；热区文档堆积、总路线图变臃肿、坏链、唯一下一包不清楚时。Use for project roadmap/plan/decision docs, next-package routing, hot/cold doc archiving and doc-gate checks in any repo.
---

# 项目文档流转

目的：任何模型、任何新会话打开仓库，**三跳之内**找到“现在在哪、下一步做什么、为什么这样定”，并且历史不污染当前排期。

## 五个载体（各管一件事，不互相抄）

| 载体 | 只管什么 | 不许放什么 |
|---|---|---|
| 总路线图（`roadmap`） | 当前方向、最近有证据的生产锚、指向其他载体的路由表；≤8KB | 包的过程、长清单、历史流水 |
| 排期页（`plan`） | **第0节一行 `**唯一下一包**:`** + 队列；目标与真实起点；已关账包遗留；开放事项 | 已完成包的过程细节（进冷区） |
| 决策页（`decisions`） | 仍生效的决定 = 决定 + 拍板人原话与日期 + 边界 | 被取代的决定（移出，冷区记替代关系） |
| 完成台账（`ledger`） | append-only：每包一行，关账 SHA、结果、验收、债务、过程稿位置 | 改写历史结论 |
| 冷区（`archiveDir/<日期>/`） | 已完成/停止/被取代的过程稿 + manifest + 按触发词读的 README | 当前排期；不得从冷区恢复“下一包” |

另有：索引（按问题路由，不写状态）、AGENTS.md（角色/读序/红线/交付底线）、热区（`hotDir`，新文档与任务包报告写这里）。原始证据（日志、截图、hash）放 `evidence/` 类目录，不随正文搬、不改。

## 三条硬规矩

1. **真源只认提交**。文档以远端主分支为唯一真源；不把新文档以未提交副本拷进主检出。主检出落后时用 `git-truth-sync` skill 带着 WIP 前移。
2. **唯一下一包只有一行，固定在排期页第0节**。换序要负责人拍板并改这一行；派包的人只从这里取。
3. **新计划/新阶段的第0步是关账转冷**：先回填有效决定与未结项，再搬过程稿。转冷不等于销账、不等于质量合格。

## 脚本（Node ≥18，零依赖，在目标仓库内执行）

`<skill>` = 本 skill 目录（`~/.claude/skills/project-doc-flow` 或 `~/.agents/skills/project-doc-flow`）。配置读仓库根 `.docflow.json`，字段见 [references/config.md](references/config.md)。

| 命令 | 何时 | 做什么 |
|---|---|---|
| `node <skill>/scripts/docflow-init.mjs --name <项目名>` | 新项目 | 写 `.docflow.json`，按模板建总路线图/排期页/决策页/台账/索引（AGENTS.md 缺失才建），只建不覆盖 |
| `node <skill>/scripts/check-doc-flow.mjs` | 每次改文档、关账、转冷、改导航后 | 已提交受管文档 0 坏链；排期页恰 1 份且恰 1 行唯一下一包；总路线图 ≤ 上限；热区过程稿 ≤ 上限；冷区结构完整；主分支落后/文档未提交发 WARN（`--strict-sync` 升 ERROR） |
| `node <skill>/scripts/doc-cold-archive.mjs <清单.json> [--dry-run]` | 关账转冷 | git mv 到冷区日期目录、双向重算链接、生成 manifest（源提交、前后 sha256、触发词、未结项）与 README，并 git add |

项目若已把这些脚本复制进自己的 `scripts/`（如 `npm run check:docs`），优先用项目内版本——它随项目提交，执行者的 base 里一定有。

## 工作流

**新项目**：`docflow-init` → 填总路线图“当前阶段”和排期页第0节 → 在 AGENTS.md 填红线并同步 `.docflow.json` 的 `redline` → `check-doc-flow` → 提交。

**回答“项目进行到哪”**：读总路线图 → 排期页第0节与第2节 → 必要时决策页。不要从冷区或旧对话推当前状态；生产状态只信最近有实查证据的发布审核。

**关账一个包**：报告写进热区 → 台账加一行 → 排期页更新完成范围、遗留与第0节 → 决策页只在决定变化时改 → `check-doc-flow`。

**关账转冷**：按 [references/cold-archive.md](references/cold-archive.md)。

## 写作约束

- 状态与证据绑定：上线、开关、验收结论都链接到源证据；没有证据就写“未验证”。
- 工程 ACCEPT 不外推为质量合格；整课/整体验收失败要明确保留 ESCALATE。
- 决定写原话与日期（谁、哪天、说了什么）；AI 推断不冒充拍板。
- 总路线图只同步方向和可证实锚点；排期变化改排期页，决定变化改决策页，避免第二个状态板。
