# syntax = docker/dockerfile:1

# Constellation's real image: a plain Node http server (server/), a static
# frontend (public/), node:sqlite against the /data volume fly.toml mounts,
# and README.md rendered at /readme/ by the app itself.

FROM docker.io/library/node:24-alpine

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY server/ ./server/
COPY public/ ./public/
COPY README.md ./README.md

ENV NODE_ENV=production
CMD ["node", "server/index.js"]
