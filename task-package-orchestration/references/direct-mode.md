# 改专项（单模块直改 · 免总工通道）

> 适用：John 直接说「改专项」（前端视觉、布局、按钮交互，或边界已知的单一模块优化，可任选擅长模型）。免开总工、免写冻结合同（2026-11-11 John 明确同意增设）。

1. **读边界**：先读当前仓库根 `AGENTS.md`（获取 `redline_globs`、`closed_lane_globs`、`wide_lane_globs`、`contract_doc`、`check_cmds`）。
2. **隔离现场**：先看 `git status -s` 与 `git worktree list`；若主检出有未提交改动或并行会话，先在**仓库目录外**建独立 `git worktree` 再动手，记下 `<起始SHA>`。
3. **硬边界与熔断**：
   - 只改目标模块目录；严禁触碰 `contract_doc`（共享接口契约）、`closed_lane_globs` 及未获本次明确点名的 `redline_globs`。
   - 若 John 本次专门点名给某条红线目录做视觉换皮（如 `chaoye` 的渲染器组件），只改样式/展现、**不改外部接口与逻辑**，白名单机检传 `--allow-redline "<该条glob>"`。
   - 中途若发现必须改跨模块 API 字段、共享 schema/迁移，或触及封死泳道才能做完，**立即停手列出分叉点**交 John 或总工裁决，绝不顺手越界。
4. **自验与收口**：
   - 跑 `node ~/.agents/skills/task-package-orchestration/scripts/check-package-whitelist.mjs --base <起始SHA> --allow '<模块目录>/**'` 与相关 `check_cmds`。
   - 前端/UI 改动**必须在浏览器或真实运行态实看效果**，不以构建或单测通过代替。
   - `contained` 局部打磨验绿后可由 John 直接收口（若顺手完成排期正式待办项，同步补记台账末行）；触及 `wide_lane_globs` 合入前另开新窗口扫一遍 `git diff`。
