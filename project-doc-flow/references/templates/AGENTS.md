# {{项目名}} · 项目级 AI 入口（所有模型共用）

## 1. 角色

- 角色只来自当前提示与任务授权，不来自模型品牌：`ROLE=ORCHESTRATOR`（总工/主对话）、`ROLE=EXECUTOR`（实现会话）、`ROLE=REVIEWER`（独立审核）。拿不准按 EXECUTOR，不得自升。
- `RELEASE_OWNER` 是与角色分离的显式授权；只有被明确指定者可以 merge、push、deploy 或操作共享资源。

## 2. 读序

- ORCHESTRATOR：本文件 → [总路线图]({{link:roadmap}}) → [排期页]({{link:plan}})第0节 → 必要规格。
- EXECUTOR：只读本文件 + 冻结任务包 + 任务包列出的材料。
- REVIEWER：本文件 + 冻结合同 + 真实 diff 与原始证据。

## 3. 红线

- （只读目录、迁移由人写、i18n 只增不改等，按项目填写；同步写进 `.docflow.json` 的 `redline`。）
- 触及红线、扩大白名单、新增依赖、改变产品/架构/迁移/钱账/隐私口径或不可逆操作时，停止并请求明确授权。

## 4. 交付底线

- 冻结实现包在独立 branch/worktree 执行，只改白名单；交付真实 commit/diff、逐项验证、做了/没做/为什么、偏离与风险，报告写入热区目录。
- 审核只认真实 diff、原始结果与运行证据；结论只有 ACCEPT / REWORK_ONCE / ESCALATE。
