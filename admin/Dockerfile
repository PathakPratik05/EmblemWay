# syntax=docker/dockerfile:1.7
# EmblemWay admin dashboard (Next.js standalone output). The API URL is a RUNTIME setting
# (ADMIN_API_BASE_URL) because all backend calls happen server-side.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npx next build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd --system emblemway && useradd --system --gid emblemway emblemway
COPY --from=build --chown=emblemway:emblemway /app/.next/standalone ./
COPY --from=build --chown=emblemway:emblemway /app/.next/static ./.next/static
USER emblemway
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
