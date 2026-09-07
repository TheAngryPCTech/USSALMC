# apps/trade-submit/Dockerfile — containerize the public trade-route submission
# app (web form + bot-style command). It talks ONLY to the core API over HTTP
# (no DB access), so it needs just its own deps. Runtime = `npm start` (tsx),
# identical to dev — containerization only, no code changes.

# ---------- build stage ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app/apps/trade-submit
COPY apps/trade-submit/package*.json ./
RUN npm install --no-audit --no-fund
COPY apps/trade-submit ./
RUN npm run build

# ---------- runtime stage ----------
FROM node:22-bookworm-slim
WORKDIR /app/apps/trade-submit
COPY --from=build /app/apps/trade-submit /app/apps/trade-submit
# TRADE_SUBMIT_PORT is read by the app; container listens on it (see compose)
EXPOSE 5000
CMD ["npm", "start"]
