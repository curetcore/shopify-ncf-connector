# NCF Manager - Shopify Connector
# Dockerfile para producción en Easypanel

FROM node:20-alpine AS base
RUN apk add --no-cache openssl

# Build stage
FROM base AS builder
WORKDIR /app

# Copiar archivos de dependencias
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Instalar todas las dependencias (incluyendo dev para build)
RUN npm ci

# Copiar código fuente
COPY . .

# Generar Prisma client y build
RUN npx prisma generate
RUN npm run build

# Eliminar dependencias de desarrollo
RUN npm prune --production

# Production stage
FROM base AS production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copiar desde builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

# Ejecutar migraciones y arrancar
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
