FROM node:24-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application files
COPY lib/ ./lib/
COPY public/ ./public/
COPY server.mjs ./

# Create data directory and non-root user
RUN mkdir -p /app/data && \
    addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app/data

USER appuser

ENV TZ=Asia/Shanghai

EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "import('http').then(h=>h.get('http://localhost:3456/health',r=>{process.exit(r.statusCode===200?0:1)}))"

# Use dumb-init for proper signal handling (alpine has it)
CMD ["node", "--max-old-space-size=512", "--expose-gc", "server.mjs"]
