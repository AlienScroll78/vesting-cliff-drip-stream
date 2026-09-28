# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build the Soroban WASM contract
# ─────────────────────────────────────────────────────────────────────────────
FROM rust:1.82-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    && rm -rf /var/lib/apt/lists/* \
    && rustup target add wasm32-unknown-unknown

WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY .cargo .cargo
COPY src src

RUN cargo build --release --target wasm32-unknown-unknown

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Serve the artefact via nginx (non-root, read-only FS)
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# OCI image labels (populated at build time via --build-arg / --label flags)
ARG BUILD_DATE
ARG GIT_REVISION
ARG VERSION

LABEL org.opencontainers.image.title="vesting-cliff-drip-stream" \
      org.opencontainers.image.description="Soroban cliff-vesting WASM served via nginx" \
      org.opencontainers.image.source="https://github.com/your-org/vesting-cliff-drip-stream" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${GIT_REVISION}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="MIT"

# Create a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/target/wasm32-unknown-unknown/release/*.wasm /usr/share/nginx/html/
COPY public /usr/share/nginx/html/

# Custom nginx config: non-root port 8080, wasm MIME, security headers
RUN printf 'server {\n\
    listen 8080;\n\
    root /usr/share/nginx/html;\n\
    server_tokens off;\n\
    add_header X-Content-Type-Options "nosniff" always;\n\
    add_header X-Frame-Options "DENY" always;\n\
    add_header X-XSS-Protection "1; mode=block" always;\n\
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
        add_header Cache-Control "public, max-age=3600";\n\
    }\n\
    location ~* \\.wasm$ {\n\
        add_header Content-Type application/wasm;\n\
        add_header Cache-Control "public, max-age=31536000, immutable";\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

# nginx needs to write to these at runtime; own them as the non-root user
RUN mkdir -p /var/cache/nginx /var/run /var/log/nginx \
    && chown -R appuser:appgroup /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html \
    && sed -i 's|/var/run/nginx.pid|/var/run/nginx.pid|g' /etc/nginx/nginx.conf \
    && touch /var/run/nginx.pid \
    && chown appuser:appgroup /var/run/nginx.pid

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
