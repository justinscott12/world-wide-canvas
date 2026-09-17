# Portable image — runs on Fly.io, Railway, or any VPS with Docker.
FROM node:20-slim

WORKDIR /app

# Install deps first for better layer caching. better-sqlite3 ships prebuilt
# binaries for linux/x64, so no compiler toolchain is needed here.
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build:client

# World data lives on a persistent volume so the canvas survives restarts.
ENV WWC_DB_FILE=/app/data/world.db
ENV PORT=8787
VOLUME ["/app/data"]
EXPOSE 8787

CMD ["npm", "start"]
