# Stage 1: Build the Soroban WASM contract
FROM rust:1.82-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    && rm -rf /var/lib/apt/lists/* \
    && rustup target add wasm32-unknown-unknown

WORKDIR /app
COPY Cargo.toml ./
COPY .cargo .cargo
COPY src src

RUN cargo build --release --target wasm32-unknown-unknown

# Stage 2: Serve the artefact via nginx
FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/target/wasm32-unknown-unknown/release/*.wasm /usr/share/nginx/html/
COPY --from=builder /app/public /usr/share/nginx/html/

COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 80;
    root /usr/share/nginx/html;
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "public, max-age=3600";
    }
    location ~* \.wasm$ {
        add_header Content-Type application/wasm;
    }
}
EOF

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
