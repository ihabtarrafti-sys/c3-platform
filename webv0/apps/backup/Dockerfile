# C3 staging backup/restore image. Build context = the webv0/ npm root:
#   docker build -f apps/backup/Dockerfile -t c3web-backup .        (from webv0/)
#
# Contains: Node 22 (pinned) + PostgreSQL 18 client (pg_dump/pg_restore, major-
# matched to the live server 18.4) from PGDG + a pinned, checksum-verified age
# binary. Runs as a non-root user. One-shot: the cron entrypoint exits after
# each run (no long-running process).
FROM node:22.14.0-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backup/package.json ./apps/backup/
# Only the backup workspace's production deps; no API, no test-support, no web.
RUN npm ci --omit=dev --workspace apps/backup --no-audit --no-fund

FROM node:22.14.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# PostgreSQL 18 client (pg_dump/pg_restore) from the official PGDG repository.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-client-18; \
    # Pinned age (FiloSottile) static binary, checksum-verified.
    AGE_VERSION=1.2.1; \
    AGE_SHA256=7df45a6cc87d4da11cc03a539a7470c15b1041ab2b396af088fe9990f7c79d50; \
    curl -fsSL "https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/age-v${AGE_VERSION}-linux-amd64.tar.gz" -o /tmp/age.tgz; \
    echo "${AGE_SHA256}  /tmp/age.tgz" | sha256sum -c -; \
    tar -xzf /tmp/age.tgz -C /tmp; \
    install -m 0755 /tmp/age/age /usr/local/bin/age; \
    install -m 0755 /tmp/age/age-keygen /usr/local/bin/age-keygen; \
    rm -rf /tmp/age /tmp/age.tgz; \
    age --version; pg_dump --version; \
    apt-get purge -y curl gnupg; apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY apps/backup ./apps/backup
# The composed per-org restore step (B-5/A-5) imports exactly this ONE
# self-contained file by relative path (no runtime deps beyond node built-ins;
# 'pg' is type-only there). Deliberately NOT a workspace install — this
# credentialed image stays minimal.
COPY packages/persistence/src/exportTenant.ts ./packages/persistence/src/exportTenant.ts

# Non-root runtime (the official node user).
USER node

# One-shot dispatcher: JOB_MODE=backup (default) or JOB_MODE=restore. Exits
# after the selected job; no long-running process.
CMD ["node", "node_modules/tsx/dist/cli.mjs", "apps/backup/src/entrypoint.ts"]
