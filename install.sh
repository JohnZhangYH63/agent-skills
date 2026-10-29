#!/usr/bin/env bash
# 把本仓库的 skill 以符号链接装到 Claude Code(~/.claude/skills)与 Codex(~/.agents/skills)。
# 已存在的同名真实目录不覆盖(提示后跳过);已是指向这里的链接则跳过。可重复运行。
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
for dest in "$HOME/.claude/skills" "$HOME/.agents/skills"; do
  mkdir -p "$dest"
  for skill in "$SRC"/*/; do
    name="$(basename "$skill")"
    [ -f "$skill/SKILL.md" ] || continue
    target="$dest/$name"
    if [ -L "$target" ]; then
      [ "$(readlink "$target")" = "${skill%/}" ] && { echo "已装 $target"; continue; }
      echo "跳过 $target:已是指向别处的链接"; continue
    fi
    if [ -e "$target" ]; then echo "跳过 $target:已有同名目录,请先手动处理"; continue; fi
    ln -s "${skill%/}" "$target" && echo "链接 $target -> ${skill%/}"
  done
done
