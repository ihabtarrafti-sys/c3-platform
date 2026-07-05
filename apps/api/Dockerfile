# C3 Web V0 API image. Build context = repository root:
#   docker build -f apps/api/Dockerfile -t c3web-api .
#
# V0 runs the TypeScript sources directly via tsx (no separate build step). The
# migration runner is invoked as a one-shot before the API starts (see the
# staging compose file / runbook). Image slimming (pruning the frozen SPFx
# workspaces from the install) is a Phase 2 follow-up.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
COPY tsconfig.base.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app /app
EXPOSE 4000
# The app connects ONLY as the least-privileged c3_app role (DATABASE_URL).
CMD ["node", "node_modules/tsx/dist/cli.mjs", "apps/api/src/server.ts"]
