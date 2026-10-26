FROM node:24-bookworm-slim
WORKDIR /app
COPY deployment/channex-staging-worker/package.json deployment/channex-staging-worker/package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev
COPY src/lib/availability.ts src/lib/rate-plan.ts src/lib/rental-periods.ts src/lib/sca-quotes-types.ts src/lib/occupancy-tax.ts src/lib/property-scope.ts ./src/lib/
COPY src/lib/channex-staging ./src/lib/channex-staging
COPY src/lib/channex-bookings ./src/lib/channex-bookings
COPY src/lib/calderwood-readonly/channex.ts src/lib/calderwood-readonly/calendar-window.ts ./src/lib/calderwood-readonly/
COPY src/lib/calderwood-rehearsal ./src/lib/calderwood-rehearsal
COPY scripts/channex-shared-worker.mts ./scripts/channex-shared-worker.mts
COPY scripts/channex-inventory-rehearsal.mts ./scripts/channex-inventory-rehearsal.mts
COPY scripts/channex-inventory-archive.mts ./scripts/channex-inventory-archive.mts
COPY scripts/verify-provider-worker-package.mjs ./scripts/verify-provider-worker-package.mjs
COPY scripts/channex-provider-rehearsal.mts ./scripts/channex-provider-rehearsal.mts
USER node
RUN node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-provider-worker-package.mjs
ENV CHANNEX_WORKER_MODE=isolated-staging
CMD ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/channex-shared-worker.mts"]
