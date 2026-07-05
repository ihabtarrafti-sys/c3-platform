# C3 Web V0 API image (hardened). Build context = repository root:
#   docker build -f apps/api/Dockerfile -t c3web-api .
#
# Properties:
#   - pinned Node LTS runtime (matches the repo's supported engine range);
#   - multi-stage: the runtime stage contains ONLY the API's production
#     dependency chain (npm ci --omit=dev -w apps/api) — no devDependencies,
#     no @c3web/test-support, no embedded-postgres binaries, no frozen SPFx
#     source, no Playwright/vitest;
#   - non-root runtime user (the official `node` user);
#   - graceful SIGTERM (handled in src/server.ts; exec-form CMD keeps signals);
#   - /health (liveness) and /ready (DB readiness) endpoints;
#   - no build/emit step -> no source maps to leak (tsx executes TS directly).
FROM node:22.14.0-slim AS deps
WORKDIR /app
# Lockfile-driven install. Every workspace's manifest must be present for npm
# to resolve the workspace graph, but only the API chain's SOURCE is copied.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/c3/package.json          ./packages/c3/
COPY packages/c3-runtime/package.json  ./packages/c3-runtime/
COPY packages/c3-spfx-host/package.json ./packages/c3-spfx-host/
COPY packages/runtime-sdk/package.json ./packages/runtime-sdk/
COPY packages/test-support/package.json ./packages/test-support/
COPY apps/web/package.json             ./apps/web/
COPY packages/domain        ./packages/domain
COPY packages/authz         ./packages/authz
COPY packages/api-contracts ./packages/api-contracts
COPY packages/application   ./packages/application
COPY packages/persistence   ./packages/persistence
COPY apps/api               ./apps/api
RUN npm ci --omit=dev --workspace apps/api --no-audit --no-fund \
  # npm's workspace filter still resolves the test-support manifest; purge its
  # tree AND the embedded-postgres binaries from the runtime image entirely.
  && rm -rf packages/c3 packages/c3-runtime packages/c3-spfx-host packages/runtime-sdk packages/test-support apps/web \
       node_modules/@c3web/test-support node_modules/embedded-postgres node_modules/@embedded-postgres \
  && node -e "const fs=require('fs'); for (const p of ['node_modules/embedded-postgres','node_modules/@embedded-postgres','packages/test-support']) if (fs.existsSync(p)) { console.error('LEAK: '+p); process.exit(1); } console.log('runtime image graph clean');"

FROM node:22.14.0-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps --chown=node:node /app /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Exec form: SIGTERM reaches the node process (graceful shutdown in server.ts).
CMD ["node", "node_modules/tsx/dist/cli.mjs", "apps/api/src/server.ts"]
