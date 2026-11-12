# 带着 WIP 把主检出前移到远端主分支

适用：本地主分支落后远端（`check-doc-flow` 报 WARN），而工作区里有别人或自己的未提交改动，不能 `reset --hard`、不想 `stash`。

## 0. 前提

- 当前会话被明确授权为 RELEASE_OWNER（或用户亲自要求前移）。
- 近几小时没有别的会话在改这个检出：`find . -newermt '-3 hours' -type f -not -path './node_modules/*' -not -path './.git/*' | head`。有 → 停下问。

## 1. 快照（不碰工作区）

```bash
node <skill>/scripts/snapshot.mjs --name snapshot/main-worktree-YYYYMMDD
```

用临时 `GIT_INDEX_FILE` + `add -A` + `write-tree` + `commit-tree` 存成本地分支。之后任何一步出错都能 `git checkout <快照> -- <路径>` 取回。**快照分支不推**（常含大素材）。

## 2. 分类

```bash
git fetch <远端>
node <skill>/scripts/classify-dirty.mjs --target <远端>/<主分支> [--copy-ref <文档副本来源分支>] --out /tmp/gts-classify.json
```

- `blocking` 必须为 0；不为 0 先人工处理（本机独有文件和目标同名）。
- `doc_tracked_genuine` 要逐个看：目标分支也改过的，前移后用 `git merge-file` 三方合并。

## 3. 复核快照后没人动过

```bash
node <skill>/scripts/snapshot.mjs --verify snapshot/main-worktree-YYYYMMDD
```

## 4. 腾路 → 快进 → 放回

```bash
# 4a 存代码 WIP 补丁(二进制安全;code_tracked 为空时不生成补丁,防空 pathspec 误把旧文档打进去)
rm -f /tmp/gts-wip.patch
node -e '
  const { readFileSync, writeFileSync } = require("fs");
  const { execFileSync } = require("child_process");
  const files = JSON.parse(readFileSync("/tmp/gts-classify.json", "utf8")).code_tracked;
  if (files.length) writeFileSync("/tmp/gts-wip.patch", execFileSync("git", ["diff", "--binary", "HEAD", "--", ...files], { maxBuffer: 1 << 28 }));
'
# 4b 真文档改动拷到临时目录(doc_tracked_genuine 非空时)
# 4c 已跟踪改动还原到 HEAD,并删除与副本来源逐字节相同的 untracked_stale(均已在快照里)
node -e '
  const { readFileSync, rmSync } = require("fs");
  const { execFileSync } = require("child_process");
  const c = JSON.parse(readFileSync("/tmp/gts-classify.json", "utf8"));
  const tracked = [...c.code_tracked, ...c.doc_tracked_stale, ...c.doc_tracked_genuine];
  if (tracked.length) execFileSync("git", ["checkout", "HEAD", "--", ...tracked]);
  for (const p of c.untracked_stale) rmSync(p, { force: true });
'
# 4d 确认没有已跟踪改动,然后快进
git status --porcelain -uno   # 应为空
git merge --ff-only <远端>/<主分支>
# 4e 放回代码 WIP(仅当存在非空补丁时)
if [ -s /tmp/gts-wip.patch ]; then
  git apply --3way /tmp/gts-wip.patch || true
  git diff --name-only --diff-filter=U   # 应为空;非空说明三方合并有冲突,先人工解决再 reset
  git reset -q                           # 退回成未暂存改动,保持原状
fi
# 4f 拷回真文档改动(目标也改过的用 git merge-file)
```

## 5. 核对

```bash
node <skill>/scripts/verify-against-snapshot.mjs --snapshot snapshot/main-worktree-YYYYMMDD --classify /tmp/gts-classify.json
```

- `differs` / `missing` 必须为 0；
- `merged` 是三方合并过的文件：结构化文件（JSON、i18n）逐键比对“WIP 改的键保留快照值、目标改的键保留目标值”；代码文件跑类型检查/相关测试；
- 最后 `rev-list --left-right --count main...<远端>/<主分支>` 应为 `0 0`，工作区只剩 WIP。

## 坑

- `git hash-object <路径>` 会**跟随符号链接**去读目标文件，拿它和 git 里存的链接 blob 比必然“不一致”——脚本已按 `120000` + 链接目标比对，自己手写核对时别踩。
- 不用 `git stash`：大量未跟踪文件 + 并行会话下 pop 冲突很难收拾，而且 stash 不在分支列表里容易被遗忘。
- 未上线的代码（审核通过但未发布）留在它自己的分支；只把它的文档带进主分支。
- 文档改动以后走分支提交（在仓库外 worktree 里改、过门禁、推送），不要再把文档以未提交副本拷进主检出。
