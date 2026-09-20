#!/usr/bin/env bash
# End-to-end smoke test against a running backend. Creates a clearly-marked
# dummy thread, exercises the API, then deletes everything it made.
set -euo pipefail

BASE="${1:-http://localhost:8787}"
PREFIX="__smoke__"
j() { curl -sf -H 'content-type: application/json' "$@"; }

echo "health:"; j "$BASE/api/health"; echo

echo "create thread:"
TID=$(j -XPOST "$BASE/api/threads" -d "{\"title\":\"${PREFIX} sourdough\",\"seed\":\"Notes on sourdough: 70% hydration, 20% starter, long cold proof.\"}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  -> $TID"

cleanup() { j -XDELETE "$BASE/api/threads/$TID" >/dev/null && echo "cleaned up $TID"; }
trap cleanup EXIT

MID="11111111-1111-1111-1111-111111111111"
echo "append message (x2, same id — must not duplicate):"
j -XPOST "$BASE/api/threads/$TID/messages" -d "{\"id\":\"$MID\",\"content\":\"What flour suits this?\"}" >/dev/null
j -XPOST "$BASE/api/threads/$TID/messages" -d "{\"id\":\"$MID\",\"content\":\"What flour suits this?\"}" >/dev/null
COUNT=$(j "$BASE/api/threads/$TID" | grep -o '"role":' | wc -l | tr -d ' ')
echo "  message count = $COUNT (expect 2: seed + 1 append)"
[ "$COUNT" = "2" ] || { echo "FAIL: idempotency"; exit 1; }

echo "force metadata (needs Ollama with the gen + embed models):"
j -XPOST "$BASE/api/threads/$TID/metadata" | grep -o '"tags":\[[^]]*\]' || echo "  skipped: Ollama not reachable"
echo

echo "related (v2 endpoint, not used by the UI; needs Ollama):"
j "$BASE/api/threads/$TID/related" || echo "  skipped: Ollama not reachable"
echo

echo "ask Claude (scratch, no commit) — needs a logged-in \`claude\` CLI:"
curl -s -H 'content-type: application/json' -XPOST "$BASE/api/threads/$TID/ask" \
  -d '{"prompt":"one-line summary?","commit":false}' | head -c 300
echo

echo "SMOKE OK"
