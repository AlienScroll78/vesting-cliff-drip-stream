# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# backend/Dockerfile
#
# Multi-stage build for the vesting-drips backend API server.
#
# Stages:
#   deps     — install production + dev dependencies (layer-cached)
#   build    — compile TypeScript to dist/
#   prod     — minimal runtime image (no source, no dev deps, non-root)
#
# Image size target: < 150 MB
# Non-root user: node (uid 1000)
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Install all dependencies ────────────────────────────────────────
# Pin to a specific minor version for reproducibility. Using alpine for
# a smaller base (no glibc, but node native modules that need it are excluded).
FROM node:22.11.0-alpine3.20 AS deps

# Install build tools needed for native addons (e.g. pg has no native addon
# but other optional deps might). Remove after install to keep the layer small.
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy dependency manifests first — this layer is cached as long as they don't
# change, so `npm ci` only re-runs when package.json or package-lock.json change.
COPY package.json package-lock.json ./

# Install *all* deps (including devDependencies) — needed to compile TypeScript.
RUN npm ci --ignore-scripts

# ── Stage 2: Compile TypeScript ───────────────────────────────────────────────
FROM deps AS build

# Copy the rest of the source
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript → dist/
RUN npx tsc --project tsconfig.json

# ── Stage 3: Production image ─────────────────────────────────────────────────
FROM node:22.11.0-alpine3.20 AS prod

# OCI labels (populated at build time via --build-arg / --label flags)
ARG BUILD_DATE
ARG GIT_REVISION
ARG VERSION

LABEL org.opencontainers.image.title="vesting-drips-backend" \
      org.opencontainers.image.description="Vesting Cliff Drip Stream backend API server" \
      org.opencontainers.image.source="https://github.com/AlienScroll78/vesting-cliff-drip-stream" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${GIT_REVISION}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="MIT"

# Install only the OS packages required at runtime (curl for healthcheck).
# No python, no build tools.
RUN apk add --no-cache curl tini

WORKDIR /app

# Copy package manifests and install *production-only* dependencies.
# This is a fresh install — no devDependencies, no TypeScript, no test runners.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy the compiled output from the build stage.
COPY --from=build /app/dist ./dist

# Copy migrations (needed at startup for node-pg-migrate).
COPY migrations ./migrations

# Drop to the built-in non-root node user (uid 1000, gid 1000).
USER node

ENV NODE_ENV=production \
    PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:3001/health || exit 1

# tini handles signal forwarding and zombie reaping
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/server.js"]
