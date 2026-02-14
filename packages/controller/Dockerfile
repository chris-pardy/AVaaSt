FROM node:20-slim AS base
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY packages/controller/package.json packages/controller/
RUN pnpm install --frozen-lockfile || pnpm install
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/controller/ packages/controller/
RUN pnpm --filter @avaast/shared build && pnpm --filter @avaast/controller build

FROM base AS runtime
WORKDIR /app
COPY --from=build /app/packages/controller/dist packages/controller/dist
COPY --from=build /app/packages/controller/package.json packages/controller/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod
EXPOSE 3001
CMD ["node", "packages/controller/dist/index.js"]
