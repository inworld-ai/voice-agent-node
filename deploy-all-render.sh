#!/usr/bin/env bash
# -----------------------------------------------------------
# Deploy all services to Render
# (both client and server)
#
# Prerequisites:
#   - Render CLI installed (https://render.com/docs/cli)
#   - Authenticated via `render login`
#
# Usage:
#   ./deploy-all-render.sh
# -----------------------------------------------------------
set -euo pipefail

CLIENT_NAME="voice-agent-smart-router-client"
SERVER_NAME="voice-agent-smart-router-server"

# --------------- Preflight checks ---------------
if ! command -v render &>/dev/null; then
  echo "Error: Render CLI is not installed."
  echo "Install it from https://render.com/docs/cli"
  exit 1
fi

# --------------- Helper function to find service ID ---------------
find_service_id() {
  local service_name="$1"
  render services list --output json 2>/dev/null \
    | python3 -c "
import sys, json
for svc in json.load(sys.stdin):
    if svc.get('service',{}).get('name') == '${service_name}':
        print(svc['service']['id'])
        break
" 2>/dev/null || true
}

# --------------- Find both services ---------------
echo "==> Looking up services..."
CLIENT_ID=$(find_service_id "${CLIENT_NAME}")
SERVER_ID=$(find_service_id "${SERVER_NAME}")

if [[ -z "${CLIENT_ID}" ]] || [[ -z "${SERVER_ID}" ]]; then
  echo ""
  if [[ -z "${CLIENT_ID}" ]]; then
    echo "  ✗ Service '${CLIENT_NAME}' not found"
  else
    echo "  ✓ Service '${CLIENT_NAME}' found: ${CLIENT_ID}"
  fi
  
  if [[ -z "${SERVER_ID}" ]]; then
    echo "  ✗ Service '${SERVER_NAME}' not found"
  else
    echo "  ✓ Service '${SERVER_NAME}' found: ${SERVER_ID}"
  fi
  
  echo ""
  echo "To create missing services for the first time:"
  echo "  1. Go to https://dashboard.render.com/"
  echo "  2. Click 'New > Blueprint'"
  echo "  3. Connect your Git repository"
  echo "  4. Render will read render.yaml and provision all services"
  echo ""
  exit 1
fi

echo "  ✓ ${CLIENT_NAME}: ${CLIENT_ID}"
echo "  ✓ ${SERVER_NAME}: ${SERVER_ID}"
echo ""

# --------------- Deploy server first (backend) ---------------
echo "============================================"
echo "  Deploying Server (1/2)"
echo "============================================"
render deploys create "${SERVER_ID}" --wait

echo ""

# --------------- Deploy client (frontend) ---------------
echo "============================================"
echo "  Deploying Client (2/2)"
echo "============================================"
render deploys create "${CLIENT_ID}" --wait

echo ""
echo "============================================"
echo "  All deployments complete!"
echo "============================================"
echo ""
echo "View services at: https://dashboard.render.com/"
