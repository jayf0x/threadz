#!/usr/bin/env bash
# Triggers the GitHub Pages deploy workflow (runs off main, no tag/version needed).
set -euo pipefail

BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$BRANCH" != "main" ]] && { echo "✗ Must be on main (currently: $BRANCH)"; exit 1; }

gh workflow run pages.yml --ref main

echo "✓ Triggered pages.yml on main — check: gh run watch"
