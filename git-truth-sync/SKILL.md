---
name: git-truth-sync
description: 保证“远端主分支是唯一真源”并且不丢任何人的未提交工作——工作区全量快照分支（不用 stash）、前移前给改动分类（真 WIP / 拷进来的旧副本 / 会挡快进的同名文件）、带着 WIP 快进主检出再三方合并放回、按快照逐文件核对（符号链接感知）、worktree 盘点与安全清理、本地独有分支推远端备份。用于：本地主分支落后远端；文档或代码以未提交副本存在于主检出；要 reset/checkout/切分支/清理 worktree 前；接手一个状态不明的检出；并行会话共用同一检出时。Use before any risky git operation on a shared or dirty checkout, and to resync a stale main without losing WIP.
---

# 真源同步与 WIP 保全

**真源只认提交**：先核对项目指定的远端主分支。通用脚本要求仓库根 `AGENTS.md` frontmatter 显式填写 `remote`、`main_branch`、`doc_managed`，或用 `--config <json>` 指定配置；缺失时停止，不猜 `origin/main`。项目已有等价脚本时优先使用项目版本。规则只有住在提交里，才能约束从 base 开工的 agent；工作区副本只对开着这个检出的会话可见。远端提交是源码依据，是否上线仍须发布证据。

## 先做的三件事（任何可能丢东西的 git 操作之前）

1. **看清现场**：`git status`、`git rev-list --left-right --count <main>...<remote>/<main>`、`git worktree list`、最近几小时有没有文件被别人改。
2. **全量快照**：`node <skill>/scripts/snapshot.mjs`——临时 index 写树，存成本地分支 `snapshot/worktree-YYYYMMDD`，不动工作区和真 index，不用 stash。快照分支只留本地。
3. **确认授权**：动共享检出、远端、worktree 删除需要 RELEASE_OWNER（见 `task-package-orchestration`）。不是你的就只报告。

## 脚本（Node ≥18，零依赖，在目标仓库内执行）

| 命令 | 做什么 |
|---|---|
| `snapshot.mjs [--name <分支>]` / `snapshot.mjs --verify <分支>` | 建全量快照 / 复核“快照后没人动过” |
| `classify-dirty.mjs --target <ref> [--copy-ref <ref>] --out <json>` | 把改动分成 code_tracked / doc_tracked_stale / doc_tracked_genuine / untracked_stale / untracked_genuine / blocking |
| `verify-against-snapshot.mjs --snapshot <分支> --classify <json>` | 前移后逐文件核对真 WIP 与本机独有文件；三方合并过的单列 `merged` 待人工看 |
| `worktree-audit.mjs [--config <json>] [--fetch] [--remove-safe]` | 默认只读本地引用，不联网、不更新引用或 index；显式 `--fetch` 刷新，失败即停止；`--remove-safe` 才尝试删除独有=0 且已确认干净的非当前 worktree |

## 主检出落后远端时

按 [references/fast-forward-with-wip.md](references/fast-forward-with-wip.md)：快照 → 分类（blocking 必须为 0）→ 复核 → 存补丁、还原、删旧副本 → `merge --ff-only` → `apply --3way` 放回 → 核对（differs/missing 为 0，merged 逐个看）→ 类型检查/相关测试。

## worktree 卫生

- worktree 一律放在**仓库目录之外**；仓库内的 worktree 会被开发服务器的文件监听扫进去。
- 清理前先 `worktree-audit.mjs`：有独有提交且远端没有的分支，先推远端同名分支备份；有未提交改动的，问它的主人，不替人删。
- `git worktree remove` 只删目录不删分支；已合并的分支可 `git branch -d`（带合并检查），不用 `-D`。

## 别做

- `git reset --hard`、`git clean -fd`、`git checkout -f` 作用于有未核对改动的检出。
- `git stash` 存大量未跟踪文件，或在并行会话共用的检出里 stash。
- 把未提交副本当真源；把审核通过但未发布的代码并进主分支。
- 用 `git hash-object` 直接核对符号链接（它跟随链接读目标，必然误报）。
- 推送快照分支。
