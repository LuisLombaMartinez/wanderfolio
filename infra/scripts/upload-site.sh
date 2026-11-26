#!/usr/bin/env bash
# Syncs frontend/dist to the site bucket and invalidates CloudFront. Runs no project code besides the
# AWS CLI, so it is the only step of a publish that needs credentials. Needs aws.
# Reads the bucket and distribution from the stack outputs unless SITE_BUCKET / DISTRIBUTION_ID are set.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK="${STACK_NAME:-Viajecito}"

# Prints one stack output; fails when it is missing, empty or the CLI's literal "None".
output() {
  local value
  value="$(aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text)" || return 1
  case "$value" in "" | None | null) echo "ERROR: stack ${STACK} has no output $1" >&2; return 1 ;; esac
  printf '%s' "$value"
}

bucket="${SITE_BUCKET:-$(output SiteBucketName)}"
distribution="${DISTRIBUTION_ID:-$(output DistributionId)}"
: "${bucket:?no site bucket}"
: "${distribution:?no distribution id}"
[ -f "$REPO_DIR/frontend/dist/index.html" ] || { echo "ERROR: frontend/dist is missing; run build-site.sh first" >&2; exit 1; }

# Hashed assets are immutable; index.html must always be revalidated.
aws s3 sync "$REPO_DIR/frontend/dist" "s3://${bucket}" --delete --exclude index.html \
  --cache-control "public,max-age=31536000,immutable"
aws s3 cp "$REPO_DIR/frontend/dist/index.html" "s3://${bucket}/index.html" --cache-control "no-cache"
aws cloudfront create-invalidation --distribution-id "$distribution" --paths "/*" >/dev/null
echo "Site published to ${bucket} and CloudFront invalidated."
