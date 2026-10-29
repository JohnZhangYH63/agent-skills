# agent-skills

John 的跨项目工程流程 skill，Claude Code 与 Codex 共用（`./install.sh` 以符号链接装到 `~/.claude/skills` 与 `~/.agents/skills`）。

| skill | 管什么 |
|---|---|
| [project-doc-flow](project-doc-flow/SKILL.md) | 总路线图当路由器、排期页第0节唯一下一包、决策页、台账、热区/冷区与关账转冷；文档流转门、转冷脚本、新项目初始化 |
| [task-package-orchestration](task-package-orchestration/SKILL.md) | 显式角色与 RELEASE_OWNER、按不确定性分级、冻结任务包合同、审核三态、白名单机检 |
| [git-truth-sync](git-truth-sync/SKILL.md) | 远端主分支唯一真源；全量快照、改动分类、带 WIP 快进、按快照核对、worktree 盘点 |

三者共用仓库根的 `.docflow.json`（字段见 `project-doc-flow/references/config.md`）。新项目：

```bash
cd <项目仓库>
node ~/.claude/skills/project-doc-flow/scripts/docflow-init.mjs --name <项目名>
node ~/.claude/skills/project-doc-flow/scripts/check-doc-flow.mjs
```

来源：一次真实项目的“文档与分支真源收口”（主检出长期落后远端、数十篇过程稿堆在热区、WIP 需要三方合并回放）抽象而来。配置样例见 `project-doc-flow/examples/sample.docflow.json`；`examples/` 下其他 `*.local.json` 是本机私有样例，不进仓库。
