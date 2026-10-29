---
name: task-package-orchestration
description: 多 agent / 多模型协作的派包与审包协议——显式角色（ORCHESTRATOR / EXECUTOR / REVIEWER）与独立的 RELEASE_OWNER、按不确定性分级、冻结任务包合同（base、白名单、验收、预算、停止条件）、审核三态 ACCEPT / REWORK_ONCE / ESCALATE，配白名单机检脚本。用于：拆任务派给子代理或别的模型；写冻结任务包；审核别人交回的 diff；决定能否 merge/push/deploy；执行者需要知道自己能改什么。只在当前提示授予编排/派包/审包职责时用于编排；纯执行会话只读合同部分。Use for delegating work to subagents or other models, writing frozen task contracts, and reviewing delivered diffs in any repo.
---

# 任务包编排

把高能力模型用在不确定性、关键决策和证据终审上，把边界清楚的工作交给合适的执行者，**同一套验收标准**。

## 角色闸（先定角色，再做事）

- 角色只来自当前提示和任务授权，不来自模型品牌或能力：`ORCHESTRATOR`（总工/主对话：拆包、派包、审包）、`EXECUTOR`（拿冻结合同干活）、`REVIEWER`（独立审核，无修复授权就只报告）。拿不准按 `EXECUTOR`，**不得自升**。
- `RELEASE_OWNER` 是单独的显式授权：只有被点名者可以 merge、push、deploy、动共享 Docker/生产/远端。编排者身份本身不带这个权。
- 收到冻结合同即为 EXECUTOR：不重新切包、不派 agent、不扩白名单、不改状态文档、不 merge/push/deploy。
- 读本 skill 不授予任何权限。

## 分级（按不确定性和风险，不按文件数）

| 级别 | 什么活 | 谁做 |
|---|---|---|
| `FLAGSHIP_DIRECT` | 产品/架构未定、根因未知、跨模块契约、钱账/鉴权/安全/迁移/并发/生产、首个完整视觉纵切片 | 当前可用的最高能力模型直接做或全程主导 |
| `BOUNDED_EXECUTION` | 目标、范围、行为合同、验证方法都已冻结，可独立验收 | 均衡模型 |
| `MECHANICAL` | 搜索、改名、格式、文档同步、按明确模式补测试 | 低成本模型 |

模型名不写成永久规则；用户当前指令决定人员配置。

## 编排流程

1. **查真实状态**：当前授权、项目排期页第0节（见 `project-doc-flow`）、真实代码与分支。不把历史对话、模型总结或“文件存在”当事实。
2. **冻结合同**：完整按 [references/task-package-contract.md](references/task-package-contract.md) 填。base 一律在 `git fetch <远端>` 之后取远端主分支或列明分支的 SHA；worktree 放在仓库目录**之外**（仓库内的 worktree 会拖垮文件监听）。
3. **派发**：提示自包含，执行者只拿合同和它列的材料。并行包必须文件域不相交，共享接口先冻结。
4. **审核**：按 [references/review-record.md](references/review-record.md)。先跑白名单机检，再自己复跑验收，再看语义 diff 和原始证据。
5. **结论只有三态**：ACCEPT / REWORK_ONCE（只一次，合同不变）/ ESCALATE。新目标或新验收口径 = 新包。
6. **关账**：报告落热区、台账加行、排期页第0节更新（`project-doc-flow`）。ACCEPT 不等于授权 merge/push/deploy——那要 RELEASE_OWNER 单独执行并核对源 SHA、工作树、目标环境与回退。

## 白名单机检

```bash
node <skill>/scripts/check-package-whitelist.mjs --base <合同base> \
  --allow 'src/feature/**' --allow 'tests/feature/**' [--deny '...'] [--head <ref>]
# 或 --allow-file whitelist.txt(每行一个 glob,! 开头为黑名单)
```

覆盖已提交 + 未提交 + 未跟踪；仓库根 `.docflow.json` 的 `redline` 恒为黑名单（合同显式授权才加 `--allow-redline`）。原始输出贴进审核记录。白名单外或碰红线 → 不得 ACCEPT。

## FALLBACK（旗舰额度不足）

只有用户明确宣布才进入，并写清作用范围。中端模型可临时编排，但**不降低验收、红线或授权标准**：缩小任务包、提高证据密度；产品/架构新决策、红线例外、迁移、钱账/隐私、生产与不可逆操作仍需原 owner gate。返修一次仍失败 → 带证据 ESCALATE 给用户，不无限重试。用户明确恢复才退出。

## 底线

- 适用门“无新增红”：基线红给原始数字和对照，不用“基本通过”“应该没问题”。
- 功能正确、内容/模型输出正确、真实可用分开记；测试全绿与成功终态不替代真实验收。
- 保留首次失败样本与实际成本，不为“全绿”删异常证据。
- 工作流结束核对没有遗留 `git stash`、未清理的临时分支或越界改动。
