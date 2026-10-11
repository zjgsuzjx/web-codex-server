FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force
COPY index.html vite.config.js ./
COPY src ./src
COPY shared ./shared
RUN NODE_OPTIONS=--max-old-space-size=1536 npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production
ARG APP_REVISION=unknown
ENV APP_REVISION=$APP_REVISION
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY test ./test
COPY src/deltas.js ./src/deltas.js
COPY scripts/smoke.mjs ./scripts/smoke.mjs
COPY scripts/role-smoke.mjs ./scripts/role-smoke.mjs
COPY scripts/deploy-release.sh ./scripts/deploy-release.sh
COPY scripts/deploy-main.sh ./scripts/deploy-main.sh
USER 1000:1000
EXPOSE 3100
CMD ["node", "server/index.js"]
