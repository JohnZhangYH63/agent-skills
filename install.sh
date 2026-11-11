#!/usr/bin/env bash
# 把本仓库的 skill 与全局口令路由以符号链接装到 Claude Code、Codex 与 Gemini/Antigravity。
# 已存在的同名真实目录或内容不同的全局偏好文件绝不覆盖(提示后跳过);已装则跳过。可重复运行。
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"

for dest in "$HOME/.claude/skills" "$HOME/.agents/skills" "$HOME/.gemini/config/skills"; do
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

PREF="$SRC/GLOBAL-AGENTS.md"
if [ -f "$PREF" ]; then
  for target in "$HOME/.claude/CLAUDE.md" "$HOME/.codex/AGENTS.md" "$HOME/.gemini/GEMINI.md"; do
    mkdir -p "$(dirname "$target")"
    if [ -L "$target" ]; then
      [ "$(readlink "$target")" = "$PREF" ] && { echo "已装 $target"; continue; }
      echo "跳过 $target:已是指向别处的链接"; continue
    fi
    if [ -e "$target" ]; then
      if cmp -s "$target" "$PREF"; then
        rm "$target"
        ln -s "$PREF" "$target" && echo "链接 $target -> $PREF(同内容转符号链接)"
      else
        echo "跳过 $target:已有不同内容,请先手动核对"
      fi
      continue
    fi
    ln -s "$PREF" "$target" && echo "链接 $target -> $PREF"
  done
fi
