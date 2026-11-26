#!/usr/bin/env bash
# Total statement coverage of a Go cover profile against a floor, written to $GITHUB_STEP_SUMMARY.
# Usage: coverage-check.sh <coverprofile>   (run from backend/)
# Excludes the test helper package (internal/testenv) and generated files (*.pb.go, *_gen.go,
# *.gen.go, *_generated.go, or a "Code generated ... DO NOT EDIT." header).
set -euo pipefail

# ratchet: raise when coverage goes up, never lower without a note in the PR.
# Measured 2026-11-26: 80.5% across ./... with -coverpkg=./... and testenv excluded (80.4% with it).
FLOOR=80

profile="${1:?usage: coverage-check.sh <coverprofile>}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
module="$(go list -m)"

# Files that carry the generated-code header, as import-style paths.
generated="$(grep -rlE '^// Code generated .* DO NOT EDIT\.$' --include='*.go' . 2>/dev/null | sed "s#^\./#${module}/#" || true)"

result="$(awk -v generated="$generated" '
  BEGIN { n = split(generated, g, "\n"); for (i = 1; i <= n; i++) if (g[i] != "") skip[g[i]] = 1 }
  NR == 1 { next }                                   # "mode:" line
  {
    split($1, loc, ":"); file = loc[1]
    if (file ~ /\/internal\/testenv\// || file ~ /(\.pb|_gen|\.gen|_generated)\.go$/ || (file in skip)) next
    key = $1; stmts[key] = $2; file_of[key] = file
    if ($3 > 0) hit[key] = 1
  }
  END {
    for (k in stmts) {
      total += stmts[k]; ft[file_of[k]] += stmts[k]
      if (k in hit) { cov += stmts[k]; fc[file_of[k]] += stmts[k] }
    }
    printf "TOTAL %.1f\n", (total ? 100 * cov / total : 0)
    for (f in ft) printf "FILE %.1f %s\n", 100 * fc[f] / ft[f], f
  }' "$profile")"

total="$(awk '$1 == "TOTAL" { print $2 }' <<<"$result")"
{
  echo "### Go coverage"
  echo "Total **${total}%** (floor ${FLOOR}%)"
  echo
  echo "Lowest files:"
  echo
  echo "| file | coverage |"
  echo "|---|---|"
  awk '$1 == "FILE" { print $2, $3 }' <<<"$result" | sort -n | head -5 | sed "s#${module}/##" | awk '{ printf "| %s | %s%% |\n", $2, $1 }'
} | tee -a "$summary"

if awk -v t="$total" -v f="$FLOOR" 'BEGIN { exit !(t < f) }'; then
  echo "::error::Go coverage ${total}% is below the floor of ${FLOOR}%. Add tests; do not lower the floor." >&2
  exit 1
fi
