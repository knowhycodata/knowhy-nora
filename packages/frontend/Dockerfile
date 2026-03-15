# Build aşaması
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Build-time env vars (Cloud Run deploy sırasında --build-arg ile verilir)
ARG VITE_API_URL=/api
ARG VITE_WS_URL=""
ARG VITE_GOOGLE_API_KEY=""
ARG VITE_GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-preview-12-2025
ARG VITE_LIVE_VOICE_NAME=Puck

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_GOOGLE_API_KEY=$VITE_GOOGLE_API_KEY
ENV VITE_GEMINI_LIVE_MODEL=$VITE_GEMINI_LIVE_MODEL
ENV VITE_LIVE_VOICE_NAME=$VITE_LIVE_VOICE_NAME

RUN npm run build

# Production aşaması - Nginx ile serve et
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# Hem lokal (docker-compose) hem Cloud Run için nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Cloud Run PORT=8080 kullanır, nginx'i o port'a bağla
# envsubst ile BACKEND_URL runtime'da inject edilir
ENV BACKEND_URL=http://backend:3001
ENV PORT=80

EXPOSE 80

# Runtime: envsubst ile template'den config üret, sonra nginx başlat
CMD ["/bin/sh", "-c", "envsubst '${BACKEND_URL}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
