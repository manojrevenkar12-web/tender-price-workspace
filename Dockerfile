# syntax=docker/dockerfile:1.7
# One file, three images:
#   docker build --target api   -t tpw-api .    API and worker (node runs the TypeScript directly)
#   docker build --target web   -t tpw-web .    the built web app behind nginx
#   docker build --target tools -t tpw-tools .  seed and evaluation (demo and CI only)

FROM node:22.22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CYPRESS_INSTALL_BINARY=0
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/sim/package.json packages/sim/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

FROM manifests AS api-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter "@tpw/api..."

FROM base AS api
ENV NODE_ENV=production
COPY --from=api-deps /app /app
COPY packages/domain/src packages/domain/src
COPY apps/api/src apps/api/src
COPY apps/api/migrations apps/api/migrations
COPY apps/api/data apps/api/data
WORKDIR /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.ts"]

FROM manifests AS all-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM all-deps AS web-build
COPY packages/domain packages/domain
COPY apps/web apps/web
RUN pnpm --filter @tpw/web run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS web
COPY apps/web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
ENV API_UPSTREAM=http://api:4000
EXPOSE 8080

FROM all-deps AS tools
COPY packages packages
COPY apps/api apps/api
COPY reports reports
ENTRYPOINT ["pnpm"]
CMD ["db:seed"]
