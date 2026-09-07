# apps/api/Dockerfile — containerize the core REST API (Phase 4).
# Build context is the PROJECT ROOT (see docker-compose.yml) because the API
# entrypoint applies the SQL migrations in /db/migrations and the seed lives in
# /db/seed. Runtime keeps the exact dev behavior: it runs `npm start` (tsx),
# so no application code path changes — this is containerization only.

# ---------- build stage: install deps + run the TypeScript build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app/apps/api
# install deps first (better layer caching); include optional @xenova so the
# embedding model behaves identically to dev
COPY apps/api/package*.json ./
RUN npm install --no-audit --no-fund
# copy API source + the shared db assets it needs at build/runtime
COPY apps/api ./
# run the build script (tsc) to validate the TS compiles — the "build" step
RUN npm run build

# ---------- runtime stage ----------
FROM node:22-bookworm-slim
# postgresql-client provides psql for the migration entrypoint
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/apps/api
# bring over installed deps + source (+ compiled dist) from the build stage
COPY --from=build /app/apps/api /app/apps/api
# migrations + seed data (applied by the entrypoint against the "db" service)
COPY db /app/db
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
# API_PORT is read by the app; container listens on it (see .env / compose)
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "start"]
