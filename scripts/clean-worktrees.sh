#!/usr/bin/env bash
# Removes leftover agent worktrees (.claude/worktrees/*) and their branches, but only when nothing
# would be lost: the worktree is clean and every commit on its branch already exists in main
# (`git cherry` shows no "+", so cherry-picked/rebased copies count). Anything else is skipped.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
base=${1:-main}
removed=0 kept=0
for w in .claude/worktrees/*/; do
  [ -d "$w" ] || continue
  w=${w%/}
  b=$(git -C "$w" branch --show-current)
  if [ -n "$(git -C "$w" status --porcelain)" ]; then echo "keep $w: uncommitted changes"; kept=$((kept+1)); continue; fi
  if [ -n "$b" ] && git cherry "$base" "$b" | grep -q '^+'; then echo "keep $w ($b): commits not in $base"; kept=$((kept+1)); continue; fi
  git worktree remove "$w"
  [ -n "$b" ] && git branch -D "$b" >/dev/null
  echo "removed $w${b:+ ($b)}"
  removed=$((removed+1))
done
git worktree prune
echo "done: $removed removed, $kept kept"
