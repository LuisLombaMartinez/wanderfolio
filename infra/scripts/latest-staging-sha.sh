#!/usr/bin/env bash
# Prints the commit SHA of the latest successful staging deploy (ADR-0006), for the "Deploy to prod"
# workflow. "Successful" means the "Staging deployed" job of deploy-staging.yml succeeded, which needs the
# whole stack deploy, frontend build and upload to have worked. The SHA is read from the run's name
# ("Deploy to staging <sha>"). Fails, printing nothing, when there is none.
#
# Needs the gh CLI with GH_TOKEN (actions: read) and GITHUB_REPOSITORY (owner/name) set.
set -euo pipefail

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"

runs="$(gh run list --repo "$GITHUB_REPOSITORY" --workflow deploy-staging.yml --status success \
  --limit 30 --json databaseId,displayTitle --jq '.[] | "\(.databaseId)\t\(.displayTitle)"')"

while IFS=$'\t' read -r id title; do
  [ -n "$id" ] || continue
  done_jobs="$(gh run view "$id" --repo "$GITHUB_REPOSITORY" --json jobs \
    --jq '[.jobs[] | select(.name == "Staging deployed" and .conclusion == "success")] | length')"
  [ "$done_jobs" = "1" ] || continue
  if [[ "$title" =~ ^Deploy\ to\ staging\ ([0-9a-f]{40})$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    exit 0
  fi
  echo "run $id has an unexpected name: $title" >&2
done <<< "$runs"

echo "No successful staging deploy found. Merge to main and wait for staging first." >&2
exit 1
