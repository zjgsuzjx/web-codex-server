FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
COPY shared ./shared
RUN node --max-old-space-size=1536 --max-semi-space-size=8 --expose-gc node_modules/vite/bin/vite.js build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ARG APP_REVISION=unknown
ENV APP_REVISION=$APP_REVISION
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY scripts/smoke.mjs ./scripts/smoke.mjs
COPY scripts/role-smoke.mjs ./scripts/role-smoke.mjs
COPY scripts/deploy-release.sh ./scripts/deploy-release.sh
COPY scripts/deploy-main.sh ./scripts/deploy-main.sh
COPY scripts/deploy-build.sh ./scripts/deploy-build.sh
COPY scripts/deploy-swap.sh ./scripts/deploy-swap.sh
COPY deploy/buildkitd.toml ./deploy/buildkitd.toml
USER 1000:1000
EXPOSE 3100
CMD ["node", "server/index.js"]
