#!/usr/bin/env bash
# -----------------------------------------------------------
# Deploy voice-agent-smart-router-client to Google Cloud Run
# (Next.js app from the app/ directory)
#
# Usage:
#   ./deploy-client.sh
#
# Environment variables:
#   GCP_PROJECT_ID  (optional) - Google Cloud project ID (defaults to active gcloud project)
#   GCP_REGION      (optional) - Cloud Run region (default: us-central1)
#   IMAGE_TAG       (optional) - Docker image tag  (default: latest)
# -----------------------------------------------------------
set -euo pipefail

# --------------- gcloud alias ---------------
GCLOUD="/snap/bin/gcloud"

# --------------- Configuration ---------------
PROJECT_ID="${GCP_PROJECT_ID:-$(${GCLOUD} config get-value project 2>/dev/null)}"
if [[ -z "${PROJECT_ID}" ]]; then
  echo "Error: No GCP project found. Set GCP_PROJECT_ID or run '${GCLOUD} config set project <PROJECT_ID>'."
  exit 1
fi
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="voice-agent-smart-router-client"
REPO_NAME="voice-agent"
TAG="${IMAGE_TAG:-latest}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:${TAG}"

echo "============================================"
echo "  Deploying ${SERVICE_NAME}"
echo "============================================"
echo "Project : ${PROJECT_ID}"
echo "Region  : ${REGION}"
echo "Image   : ${IMAGE}"
echo ""

# --------------- Authenticate Docker ---------------
# Use gcloud access token to authenticate sudo docker against Artifact Registry
echo "==> Configuring Docker authentication for Artifact Registry..."
${GCLOUD} auth print-access-token | sudo docker login -u oauth2accesstoken --password-stdin "https://${REGION}-docker.pkg.dev"

# --------------- Ensure Artifact Registry repo exists ---------------
echo "==> Ensuring Artifact Registry repository '${REPO_NAME}' exists..."
${GCLOUD} artifacts repositories describe "${REPO_NAME}" \
  --location="${REGION}" \
  --project="${PROJECT_ID}" 2>/dev/null \
|| ${GCLOUD} artifacts repositories create "${REPO_NAME}" \
  --repository-format=docker \
  --location="${REGION}" \
  --project="${PROJECT_ID}" \
  --description="Voice Agent Docker images"

# --------------- Build ---------------
echo "==> Building Docker image..."
sudo docker build \
  -f app/Dockerfile \
  -t "${IMAGE}" \
  .

# --------------- Push ---------------
echo "==> Pushing Docker image..."
sudo docker push "${IMAGE}"

# --------------- Deploy to Cloud Run ---------------
echo "==> Deploying to Cloud Run..."
${GCLOUD} run deploy "${SERVICE_NAME}" \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --platform=managed \
  --timeout=3600 \
  --cpu=4 \
  --memory=4Gi \
  --port=8080 \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=10

# --------------- Print URL ---------------
echo ""
echo "============================================"
echo "  Deployment complete!"
echo "============================================"
SERVICE_URL=$(${GCLOUD} run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format='value(status.url)')
echo "Service URL: ${SERVICE_URL}"
