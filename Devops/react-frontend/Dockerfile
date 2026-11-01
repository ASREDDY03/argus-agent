# ── Build stage ───────────────────────────────────────────────────────────────
# Copy package manifests first so the npm install layer is cached until
# package*.json changes — source edits don't trigger a full reinstall.
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
# Only the compiled static assets are copied — node_modules and source are not
# present in the final image.
FROM node:18-alpine AS runtime
WORKDIR /app
RUN npm install -g serve \
    && adduser -S appuser -G node
COPY --from=builder /app/build ./build
USER appuser
EXPOSE 3000
CMD ["serve", "-s", "build"]
