FROM node:20-alpine AS base

# OpenSSL ve gerekli kütüphaneleri yükle (Prisma için)
RUN apk add --no-cache openssl openssl-dev libc6-compat

WORKDIR /app

# Bağımlılıkları kopyala ve yükle
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Prisma schema ve migration dosyalarını kopyala
COPY prisma ./prisma
RUN npx prisma generate

# Uygulama kodunu kopyala
COPY src ./src

# Cloud Run PORT env var kullanır (varsayılan 8080), lokal docker-compose için 3001
ENV PORT=8080

# Sağlık kontrolü - PORT env var'ı kullan
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/health || exit 1

EXPOSE ${PORT}

# Migration, seed ve başlatma (migration/seed hatası durumunda server yine başlasın)
CMD ["sh", "-c", "npx prisma migrate deploy || echo 'Migration skipped'; npx prisma db seed || echo 'Seed skipped'; node src/index.js"]
