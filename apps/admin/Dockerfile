# apps/admin/Dockerfile — containerize the admin scraper + review web tool (Phase 4).
# Build context is the PROJECT ROOT (see docker-compose.yml): the admin server
# imports shared modules from ../../api/src (db, entity-repo, trade-submissions),
# so the image must contain apps/api's sources AND its node_modules for those
# imports to resolve exactly as they do in dev. Runtime = `npm start` (tsx),
# identical to dev behavior — containerization only, no code changes.

# ---------- build stage ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# install the shared API deps (admin's ../../api/src imports resolve 'pg' etc.
# from apps/api/node_modules, matching the dev layout)
COPY apps/api/package*.json ./apps/api/
RUN cd apps/api && npm install --no-audit --no-fund
# install admin deps
COPY apps/admin/package*.json ./apps/admin/
RUN cd apps/admin && npm install --no-audit --no-fund
# copy sources
COPY apps/api ./apps/api
COPY apps/admin ./apps/admin
# build (tsc) — the "build the app" step; the React UI itself is static (CDN)
RUN cd apps/admin && npm run build

# ---------- runtime stage ----------
FROM node:22-bookworm-slim
WORKDIR /app/apps/admin
# copy the whole tree so both apps/api/node_modules and apps/admin/node_modules
# are present and relative imports resolve
COPY --from=build /app /app
# Chromium + its OS deps, for import-scmdb-signatures.ts (Phase 23) — renders
# a real SPA page with a real browser rather than fetching its data endpoints
# directly (see that script's own comment on why: robots.txt disallows
# /data/, so this only ever reads what the rendered page displays, same as a
# human visitor's browser). --with-deps works here (unlike on the bare host)
# because a Docker build runs as root, no sudo/TTY prompt involved.
RUN npx playwright install --with-deps chromium
# ADMIN_PORT is read by the app; container listens on it (see .env / compose)
EXPOSE 4000
CMD ["npm", "start"]
