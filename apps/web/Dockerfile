# C3 Web V0 web image (hardened). Build context = repository root:
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_BASE_URL=https://api.staging.c3hq.org -t c3web-web .
#
# Properties:
#   - pinned Node for the build stage; pinned UNPRIVILEGED nginx runtime
#     (non-root, listens on 8080);
#   - runtime stage contains only the built static assets + nginx config;
#   - vite emits no source maps in production (default), so none ship;
#   - SPA fallback, immutable hashed assets, security headers (nginx.conf).
FROM node:22.14.0-slim AS build
WORKDIR /app
ARG VITE_API_BASE_URL=http://localhost:4000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/c3/package.json           ./packages/c3/
COPY packages/c3-runtime/package.json   ./packages/c3-runtime/
COPY packages/c3-spfx-host/package.json ./packages/c3-spfx-host/
COPY packages/runtime-sdk/package.json  ./packages/runtime-sdk/
COPY packages/test-support/package.json ./packages/test-support/
COPY packages/persistence/package.json  ./packages/persistence/
COPY packages/application/package.json  ./packages/application/
COPY packages/authz/package.json        ./packages/authz/
COPY apps/api/package.json              ./apps/api/
COPY packages/domain        ./packages/domain
COPY packages/api-contracts ./packages/api-contracts
COPY apps/web               ./apps/web
RUN npm ci --workspace apps/web --no-audit --no-fund \
  && node apps/web/node_modules/vite/bin/vite.js build --root apps/web

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
