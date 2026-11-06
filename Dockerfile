FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY index.html vite.config.ts postcss.config.mjs ./
COPY src ./src
COPY lib ./lib
COPY server ./server
COPY scripts/build.mjs scripts/write-release-info.mjs ./scripts/
ARG BUILD_COMMIT=""
ARG BUILD_DIRTY="true"
RUN CHANNEL_DESK_BUILD_COMMIT="$BUILD_COMMIT" CHANNEL_DESK_BUILD_DIRTY="$BUILD_DIRTY" npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production CHANNEL_DESK_MODE=production PORT=5188
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/lib ./lib
COPY --from=build --chown=node:node /app/release-info.json ./release-info.json
USER node
EXPOSE 5188
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:5188/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
