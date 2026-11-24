# syntax=docker/dockerfile:1.7
# EmblemWay API - multi-stage production image. No secrets are baked in: all configuration
# comes from environment variables at runtime (see .env.example).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npx nest build \
    && npx tsc prisma/seed.ts --outDir dist/seed --module commonjs --target es2022 --esModuleInterop --skipLibCheck \
    && npm prune --omit=dev && npx prisma generate

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/* \
    && groupadd --system emblemway && useradd --system --gid emblemway --home /app emblemway \
    && mkdir -p /app/uploads && chown emblemway:emblemway /app/uploads
COPY --from=build --chown=emblemway:emblemway /app/node_modules ./node_modules
COPY --from=build --chown=emblemway:emblemway /app/dist ./dist
COPY --from=build --chown=emblemway:emblemway /app/prisma ./prisma
COPY --chown=emblemway:emblemway package.json docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
USER emblemway
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
