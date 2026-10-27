#!/bin/sh
# Reenvía el JSON que Claude Code pasa por stdin a Agent Office.
# Regla crítica: nunca bloquear ni romper Claude Code. Sin stdout, timeout corto, exit 0 siempre.
URL="${AGENT_OFFICE_URL:-http://127.0.0.1:4317/events}"
TS=$(date +%s%3N 2>/dev/null)
curl -s -m 1 -o /dev/null -X POST \
  -H 'content-type: application/json' \
  -H "x-emit-ts: ${TS}" \
  --data-binary @- "$URL" >/dev/null 2>&1
exit 0
