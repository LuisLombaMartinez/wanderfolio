#!/usr/bin/env bash
# Builds the frontend into frontend/dist. Needs NO AWS credentials: run it before credentials are
# configured (the dependency install and build run third-party code). The Cognito ids are passed in
# as environment variables by the caller (read from the stack outputs by the deploy workflow or wizard).
#   VITE_USER_POOL_ID  VITE_USER_POOL_CLIENT_ID
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${VITE_USER_POOL_ID:?VITE_USER_POOL_ID is required}"
: "${VITE_USER_POOL_CLIENT_ID:?VITE_USER_POOL_CLIENT_ID is required}"
case "$VITE_USER_POOL_ID$VITE_USER_POOL_CLIENT_ID" in *None*) echo "ERROR: a Cognito id is 'None'" >&2; exit 1 ;; esac
export VITE_USER_POOL_ID VITE_USER_POOL_CLIENT_ID

(cd "$REPO_DIR/frontend" && npm ci --ignore-scripts && npm run build)
echo "Site built in frontend/dist."
