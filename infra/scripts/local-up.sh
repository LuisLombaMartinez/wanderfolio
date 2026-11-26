#!/usr/bin/env bash
# Brings up the whole local stack on Floci (ADR-0005) in one command:
#   1. Floci in Docker Compose
#   2. the CDK app bootstrapped and deployed to it
#   3. a local CloudFront signing key (private half in Floci's SSM, public half in the key group)
#   4. two test Members (Cognito users with a temporary password + Member records)
#   5. frontend/.env.local pointing the SPA dev server at the local endpoints
#
# Usage: infra/scripts/local-up.sh
# Settings (env vars):
#   FLOCI_PORT       host and container port for Floci (default 4600)
#   FLOCI_NAMESPACE  Compose project and Lambda container namespace (default viajecito)
#   ECR_PORT_BASE / ECR_PORT_MAX  range for the ECR sidecar (default 5100-5199)
#   SPA_PORT         port the SPA dev/preview server runs on (default 5173)
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export FLOCI_PORT="${FLOCI_PORT:-4600}"
export FLOCI_NAMESPACE="${FLOCI_NAMESPACE:-viajecito}"
export SPA_PORT="${SPA_PORT:-5173}"
export SPA_ORIGIN="http://localhost:${SPA_PORT}"

echo "==> Starting Floci on port ${FLOCI_PORT} (namespace ${FLOCI_NAMESPACE})"
docker compose -f "$INFRA_DIR/local/docker-compose.yml" up -d --wait --wait-timeout 60 2>/dev/null \
  || docker compose -f "$INFRA_DIR/local/docker-compose.yml" up -d
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${FLOCI_PORT}/_floci/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:${FLOCI_PORT}/_floci/health" >/dev/null

# Floci accepts any credentials; these are not AWS credentials.
export AWS_ENDPOINT_URL="http://localhost:${FLOCI_PORT}"
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_REGION=eu-west-1
export AWS_DEFAULT_REGION=eu-west-1
export CDK_DEFAULT_ACCOUNT=000000000000
export CDK_DEFAULT_REGION=eu-west-1
export VIAJECITO_LOCAL=1 # allows the stack without the real budget email and key (the local ones below stand in)
export SPA_ORIGIN # the photo bucket allows browser uploads from the local SPA

cd "$INFRA_DIR"
[ -d node_modules ] || npm ci

# The same signing key flow as production (the setup wizard), with a throwaway key. Kept in
# infra/.local-signing so a second local-up reuses it (CloudFront public keys cannot change in place).
SIGNING_DIR="$INFRA_DIR/.local-signing"
mkdir -p "$SIGNING_DIR"
if [ ! -f "$SIGNING_DIR/private.pem" ]; then
  openssl genrsa -out "$SIGNING_DIR/private.pem" 2048 2>/dev/null
  chmod 600 "$SIGNING_DIR/private.pem"
fi
echo "==> Storing the local signing key in Floci's SSM"
npx tsx scripts/put-signing-key.ts "$SIGNING_DIR/private.pem"
CLOUDFRONT_PUBLIC_KEY_PROD="$(openssl rsa -in "$SIGNING_DIR/private.pem" -pubout 2>/dev/null)"
export CLOUDFRONT_PUBLIC_KEY_PROD
export BUDGET_ALERT_EMAIL=local@viajecito.test # Floci stubs Budgets; the template still carries the alarm

echo "==> Bootstrapping and deploying the CDK app to Floci"
npx cdk bootstrap "aws://000000000000/eu-west-1" >/dev/null
npx cdk deploy --require-approval never --outputs-file cdk-outputs.local.json

echo "==> Seeding test Members"
npx tsx scripts/seed-local.ts

echo "==> Local stack ready. Start the SPA with: (cd frontend && npm run dev -- --port ${SPA_PORT})"
