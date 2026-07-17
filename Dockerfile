FROM node:24-slim

# System deps: ffmpeg for video processing, curl for yt-dlp download
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp — pinned version that includes the SABR streaming fix
RUN curl -L "https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/yt-dlp" \
    -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp

# Install pnpm
RUN npm install -g pnpm@10.26.1

WORKDIR /app

# Copy workspace files
COPY . .

# Install all workspace dependencies
RUN pnpm install --frozen-lockfile

# Build the API server
RUN pnpm --filter @workspace/api-server run build

# Create persistent data directory for cookies
RUN mkdir -p /app/data

# Paths used inside the container
ENV PORT=8080
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV ASSETS_DIR=/app/attached_assets

EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
