#!/usr/bin/env bash
# Stops the local Floci stack and removes the Lambda containers Floci started.
# Uses the same FLOCI_PORT / FLOCI_NAMESPACE settings as local-up.sh.
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export FLOCI_PORT="${FLOCI_PORT:-4600}"
export FLOCI_NAMESPACE="${FLOCI_NAMESPACE:-viajecito}"

# Lambda (and registry) containers are Floci's children, not Compose services; their names
# carry the namespace. Remove them first so the Compose network can be removed too.
docker ps -aq --filter "name=floci-aws-${FLOCI_NAMESPACE}-" | xargs -r docker rm -f >/dev/null
docker compose -f "$INFRA_DIR/local/docker-compose.yml" down --volumes --remove-orphans
docker volume ls -q --filter "name=${FLOCI_NAMESPACE}" | xargs -r docker volume rm >/dev/null || true
rm -f "$INFRA_DIR/cdk-outputs.local.json"
echo "Local stack (${FLOCI_NAMESPACE}) stopped."
