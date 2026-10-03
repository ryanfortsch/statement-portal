FROM node:24-bookworm-slim
WORKDIR /app
COPY deployment/channex-staging-worker/package.json deployment/channex-staging-worker/package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev
COPY src/lib/channex-staging ./src/lib/channex-staging
COPY scripts/channex-shared-worker.mts ./scripts/channex-shared-worker.mts
USER node
ENV CHANNEX_WORKER_MODE=isolated-staging
CMD ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/channex-shared-worker.mts"]
