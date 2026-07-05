# C3 Web V0 web image. Build context = repository root:
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_BASE_URL=https://api.example -t c3web-web .
FROM node:22-slim AS build
WORKDIR /app
ARG VITE_API_BASE_URL=http://localhost:4000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci --no-audit --no-fund
RUN node apps/web/node_modules/vite/bin/vite.js build --root apps/web

FROM nginx:alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
