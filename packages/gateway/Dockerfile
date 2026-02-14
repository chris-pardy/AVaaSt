FROM node:20-slim AS base
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY packages/gateway/package.json packages/gateway/
RUN pnpm install --frozen-lockfile || pnpm install
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/gateway/ packages/gateway/
RUN pnpm --filter @avaast/shared build && pnpm --filter @avaast/gateway build

FROM base AS runtime
WORKDIR /app
COPY --from=build /app/packages/gateway/dist packages/gateway/dist
COPY --from=build /app/packages/gateway/package.json packages/gateway/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod
EXPOSE 3000
CMD ["node", "packages/gateway/dist/index.js"]
