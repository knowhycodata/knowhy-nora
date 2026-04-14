#!/bin/bash
# Nöra - Hızlı Deploy Scripti (Bash)
# Kullanım: bash deploy.sh
# Bu script Docker build alır ve Cloud Run'a deploy eder

set -e

# Renk tanımları
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Konfigürasyon
PROJECT_ID="geminichallenge-490221"
REGION="us-central1"
REPO_NAME="nora-repo"
CLOUD_SQL_INSTANCE="${PROJECT_ID}:${REGION}:nora-pg-small"
BACKEND_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/nora-backend"
FRONTEND_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/nora-frontend"
CUSTOM_FRONTEND_ORIGIN="https://nora.knowhy.app"
BACKEND_URL=""
FRONTEND_URL=""

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}   Nöra - Hızlı Deploy Scripti${NC}"
echo -e "${CYAN}========================================${NC}"

# Giriş kontrolü
echo ""
echo -e "${YELLOW}[1/7] GCloud auth kontrol ediliyor...${NC}"
if gcloud auth print-identity-token > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Auth OK${NC}"
else
    echo -e "${RED}Hata: GCloud auth yapılmamış!${NC}"
    echo -e "${YELLOW}Çalıştır: gcloud auth login${NC}"
    exit 1
fi

# Proje ID kontrolü
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)
if [ "$CURRENT_PROJECT" != "$PROJECT_ID" ]; then
    echo -e "${YELLOW}Mevcut proje: ${CURRENT_PROJECT}${NC}"
    echo -e "${YELLOW}Hedef proje: ${PROJECT_ID}${NC}"
    echo -e "${CYAN}Proje değiştiriliyor...${NC}"
    gcloud config set project "$PROJECT_ID" > /dev/null 2>&1
    echo -e "${GREEN}✓ Proje ayarlandı: ${PROJECT_ID}${NC}"
else
    echo -e "${GREEN}✓ Doğru proje aktif: ${PROJECT_ID}${NC}"
fi

# Backend Build
echo ""
echo -e "${YELLOW}[2/7] Backend Docker build alınıyor...${NC}"
docker build -t "${BACKEND_IMAGE}:latest" ./packages/backend
echo -e "${GREEN}✓ Backend build tamamlandı${NC}"

# Frontend Build
echo ""
echo -e "${YELLOW}[3/7] Frontend Docker build alınıyor...${NC}"
docker build \
    --build-arg VITE_API_URL="/api" \
    --build-arg VITE_WS_URL="" \
    -t "${FRONTEND_IMAGE}:latest" ./packages/frontend
echo -e "${GREEN}✓ Frontend build tamamlandı${NC}"

# Push images
echo ""
echo -e "${YELLOW}[4/7] Docker image'ler push ediliyor...${NC}"
docker push "${BACKEND_IMAGE}:latest"
docker push "${FRONTEND_IMAGE}:latest"
echo -e "${GREEN}✓ Push tamamlandı${NC}"

# Deploy Backend
echo ""
echo -e "${YELLOW}[5/7] Backend Cloud Run'a deploy ediliyor...${NC}"
gcloud run deploy nora-backend \
    --image "${BACKEND_IMAGE}:latest" \
    --region "${REGION}" \
    --allow-unauthenticated \
    --add-cloudsql-instances "${CLOUD_SQL_INSTANCE}" \
    --session-affinity \
    --timeout=3600 \
    --memory=512Mi \
    --cpu=1 \
    --set-env-vars "NODE_ENV=production,GOOGLE_GENAI_USE_VERTEXAI=FALSE,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_PROJECT_ID=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION},GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-preview-12-2025,GEMINI_TEXT_MODEL=gemini-2.5-flash,GEMINI_IMAGE_MODEL=gemini-2.0-flash-preview-image-generation,GEMINI_STORY_MODEL=gemini-3.1-flash-lite-preview,IMAGEN_MODEL=imagen-4.0-fast-generate-001" \
    --set-secrets "DATABASE_URL=DATABASE_URL:latest,GOOGLE_API_KEY=GOOGLE_API_KEY:latest,JWT_SECRET=JWT_SECRET:latest,GEMINI_IMAGE_API_KEY=GEMINI_IMAGE_API_KEY:latest"
echo -e "${GREEN}✓ Backend deploy tamamlandı${NC}"
BACKEND_URL=$(gcloud run services describe nora-backend --region "${REGION}" --format='value(status.url)')
echo -e "${CYAN}Backend URL: ${BACKEND_URL}${NC}"

# Deploy Frontend
echo ""
echo -e "${YELLOW}[6/7] Frontend Cloud Run'a deploy ediliyor...${NC}"
gcloud run deploy nora-frontend \
    --image "${FRONTEND_IMAGE}:latest" \
    --region "${REGION}" \
    --allow-unauthenticated \
    --port=80 \
    --memory=256Mi \
    --cpu=1 \
    --set-env-vars "BACKEND_URL=${BACKEND_URL}"
echo -e "${GREEN}✓ Frontend deploy tamamlandı${NC}"
FRONTEND_URL=$(gcloud run services describe nora-frontend --region "${REGION}" --format='value(status.url)')
echo -e "${CYAN}Frontend URL: ${FRONTEND_URL}${NC}"

# Backend frontend origin + CORS allowlist güncelle
echo ""
CORS_ALLOWED_ORIGINS="${CUSTOM_FRONTEND_ORIGIN},${FRONTEND_URL},http://localhost:5173"
echo -e "${YELLOW}[7/7] Backend frontend origin + CORS allowlist güncelleniyor...${NC}"
gcloud run services update nora-backend \
    --region "${REGION}" \
    --update-env-vars "^|^FRONTEND_URL=${CUSTOM_FRONTEND_ORIGIN}|CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS}" \
    --quiet
echo -e "${GREEN}✓ Backend frontend origin + CORS allowlist güncellendi${NC}"

# Özet
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   DEPLOY BAŞARILI!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${CYAN}URL'ler:${NC}"
echo "  Frontend (Cloud Run): ${FRONTEND_URL}"
echo "  Frontend (Custom):    ${CUSTOM_FRONTEND_ORIGIN}"
echo "  Backend:  ${BACKEND_URL}"
echo "  Health:   ${BACKEND_URL}/api/health"
echo ""
echo -e "${CYAN}Demo Hesap:${NC}"
echo "  E-posta: demo@nora.ai"
echo "  Şifre:   demo123"
