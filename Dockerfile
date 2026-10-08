FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm_config_proxy="$HTTP_PROXY" npm_config_https_proxy="$HTTPS_PROXY" \
    npm ci --no-audit --no-fund --fetch-retries=4 --fetch-retry-maxtimeout=30000
COPY app ./app
COPY components ./components
COPY hooks ./hooks
COPY core ./core
COPY model ./model
COPY modes ./modes
COPY server ./server
COPY build ./build
COPY lib ./lib
COPY public ./public
COPY docker ./docker
COPY next.config.ts postcss.config.mjs tsconfig.json ./
RUN npm run build:docker && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime
# Codex uses the system trust store for HTTPS authentication and inference.
RUN apt-get -o Acquire::http::Proxy="$HTTP_PROXY" update \
    && apt-get -o Acquire::http::Proxy="$HTTP_PROXY" install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=8080 NEXT_TELEMETRY_DISABLED=1 \
    CODEX_HOME=/data/codex CHAINFLOW_CODEX_BIN=/app/node_modules/.bin/codex
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist-docker ./dist-docker
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir -p /data/codex && chown -R node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-docker/runtime.mjs"]
