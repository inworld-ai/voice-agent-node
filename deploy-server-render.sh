#!/usr/bin/env bash
# -----------------------------------------------------------
# Deploy voice-agent-smart-router-server to Render
# (realtime-server + realtime-contract)
#
# Prerequisites:
#   - Render CLI installed (https://render.com/docs/cli)
#   - Authenticated via `render login`
#
# Usage:
#   ./deploy-server-render.sh
# -----------------------------------------------------------
set -euo pipefail

SERVICE_NAME="voice-agent-smart-router-server"

# --------------- Preflight checks ---------------
if ! command -v render &>/dev/null; then
  echo "Error: Render CLI is not installed."
  echo "Install it from https://render.com/docs/cli"
  exit 1
fi

# --------------- Find service ID ---------------
echo "==> Looking up service '${SERVICE_NAME}'..."
SERVICE_ID=$(render services list --output json 2>/dev/null \
  | python3 -c "
import sys, json
for svc in json.load(sys.stdin):
    if svc.get('service',{}).get('name') == '${SERVICE_NAME}':
        print(svc['service']['id'])
        break
" 2>/dev/null || true)

if [[ -z "${SERVICE_ID}" ]]; then
  echo ""
  echo "Service '${SERVICE_NAME}' not found in your Render workspace."
  echo ""
  echo "To create it for the first time:"
  echo "  1. Go to https://dashboard.render.com/"
  echo "  2. Click 'New > Blueprint'"
  echo "  3. Connect your Git repository"
  echo "  4. Render will read render.yaml and provision all services"
  echo ""
  exit 1
fi

echo "    Found service: ${SERVICE_ID}"

# --------------- Trigger deploy ---------------
echo "==> Triggering deploy for ${SERVICE_NAME}..."
render deploys create "${SERVICE_ID}" --wait

echo ""
echo "============================================"
echo "  Deployment complete!"
echo "============================================"
