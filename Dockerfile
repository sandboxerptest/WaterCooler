# syntax=docker/dockerfile:1

# The agent runtime shells out to the Claude Code CLI, so the image needs both
# the app and that binary. Node 24 matches local development and ships the
# built-in SQLite the room store uses.
FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable

# ── Dependencies ───────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ── Build ──────────────────────────────────────────────
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The provider is baked into the client bundle at build time, so it must be set
# here as well as at runtime
ENV AGENT_PROVIDER=claude-api
RUN pnpm build

# ── Runtime ────────────────────────────────────────────
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production

# git is needed by the agent CLI for repository-aware work
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/lib ./lib
COPY --from=build /app/types ./types

# Mounted storage: without this the room database and every agent sandbox are
# wiped on each deploy, and the office resets
ENV ROOM_DB_PATH=/data/watercooler.sqlite
ENV AGENT_WORKSPACE_ROOT=/data/agent-workspaces
ENV AGENT_PROVIDER=claude-api

EXPOSE 3000
CMD ["pnpm", "start"]
