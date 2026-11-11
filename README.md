# agent-skills

John 的跨项目工程流程 skill 与全局口令路由，Claude Code、Codex 与 Gemini/Antigravity 共用（`./install.sh` 以符号链接装到 `~/.claude/skills`、`~/.agents/skills`、`~/.gemini/config/skills`，并把 [GLOBAL-AGENTS.md](GLOBAL-AGENTS.md) 链到 `~/.claude/CLAUDE.md`、`~/.codex/AGENTS.md`、`~/.gemini/GEMINI.md`）。

| skill | 管什么 |
|---|---|
| [task-package-orchestration](task-package-orchestration/SKILL.md) | 开发任务怎么做：先判断拆不拆、按依赖画图、按撤回代价分泳道、冻结任务包合同、程序化闸门、审核三态与单元打回、关账后沉淀切包约束 |
| [project-doc-flow](project-doc-flow/SKILL.md) | 总路线图当路由器、排期页第0节唯一下一包、决策页、台账、热区/冷区与关账转冷 |
| [git-truth-sync](git-truth-sync/SKILL.md) | 远端主分支唯一真源；全量快照、改动分类、带 WIP 快进、按快照核对、worktree 盘点 |

## 分工：全局流程 + 项目内一个文件

- 流程、合同模板、脚本都在本仓库，所有项目共用。
- 每个项目只有一个文件承载项目事实：仓库根 `AGENTS.md`。顶部 frontmatter 是机器可读配置（远端、验收命令、红线、泳道），三个 skill 的脚本经 `_lib/agents-config.mjs` 直接解析；正文只留角色读序、glob 表达不了的红线、项目事实与切包约束。字段见 [project-config.md](task-package-orchestration/references/project-config.md)。
- `CLAUDE.md`、`GEMINI.md` 只写一行指向 `AGENTS.md`。

## 总工冷启动与信噪比（默认内建，无需在提示词里重复叮嘱）

- **一条命令冷启动盘点**：`doctor.mjs` 除体检外直接输出分支对齐、未提交计数、附加 worktree 数、路由入口与「唯一下一包」；编排者按三跳读序定位现状，不扫冷区。
- **子代理非对称回传**：去程不 fork 总工对话历史；过程与通过日志落盘进报告与 `gate.json`。绿包回传只给结构化短回执（强制保留 `UNVERIFIED` 未验证边界），红包直接附最小关键证据。
- **与厂商原生压缩协同、随基模变强零阻碍**：不在对话里手写滚动状态摘要（保前缀缓存、防二次有损压缩）；宿主自动压缩后从盘上轻指针重锚定，不设死轮数停机；单主循环零额外税负。
- **改专项（免总工通道）**：细则唯一真源见 [direct-mode.md](task-package-orchestration/references/direct-mode.md)。

新项目或接手旧项目：

```bash
cd <项目仓库>
S=~/.claude/skills/task-package-orchestration/scripts
node $S/doctor.mjs --init            # 看草稿(不写盘)
node $S/doctor.mjs --init --write    # 写入 AGENTS.md 顶部;核对、收紧
node $S/doctor.mjs                   # 体检:配置是否唯一、有没有规则散落
```

## 维护

- `_lib/` 是三个 skill 共用的库，脚本按相对路径引用它：skill 目录要整仓使用（符号链接），不要单独拷走。
- 改动后 `node --test tests/*.test.mjs` 全过再提交。
- 什么时候改、改哪里，见 task-package-orchestration 的 SKILL.md §12。
