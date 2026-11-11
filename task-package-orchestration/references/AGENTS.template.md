# {{项目名}} · 项目级 AI 入口（所有模型共用）

顶部 frontmatter 是本项目唯一的机器可读配置（远端、验收命令、红线、泳道）；脚本直接解析它，别在正文或别处再抄一份。

## 1. 角色与读序

- 角色只来自当前提示与任务授权，不来自模型品牌：`ROLE=ORCHESTRATOR`（拆包、派包、审包）、`ROLE=EXECUTOR`（拿冻结合同实现）、`ROLE=REVIEWER`（独立审核，没有修复授权就只报告）。拿不准按 `EXECUTOR`，不得自升。
- `RELEASE_OWNER` 是单独的显式授权：只有被点名者可以 merge、push、deploy 或操作共享资源。
- `ORCHESTRATOR`：读本文件，再完整读全局 skill `task-package-orchestration`（`~/.claude/skills/` 或 `~/.agents/skills/` 下）的 `SKILL.md`，流程以它为准。
- `EXECUTOR`：只读本文件、冻结任务包和任务包列出的材料；不重新切包、不派 agent、不扩白名单、不 merge/push/deploy。
- `REVIEWER`：读本文件、冻结合同、真实 diff 与原始证据。

## 2. 红线与泳道（glob 之外的部分）

- frontmatter 的 `redline_globs` 任何任务包都不许改；`closed_lane_globs` 不自动过闸，每次改动要 owner 明确授权并写明回退路径。
- 触及红线或封死泳道、扩大白名单、新增依赖、不可逆操作时：停下，请求明确授权。
- （glob 表达不了的项目红线写在这里，例如“某类 key 只增不改”“某文件不是废文件”。）

## 3. 项目事实

- （文档写在哪、报告落在哪、环境与基线备忘在哪。只写本项目特有的。）

## 4. 切包约束（关账后沉淀，供下次拆包）

- （每条一行：`日期 · 约束 · 来源包 · 退场条件`。只和本项目有关的写这里；跨项目成立的写回全局 skill。退场条件成立就删。）
