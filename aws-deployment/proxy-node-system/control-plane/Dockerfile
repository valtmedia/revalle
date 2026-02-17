# ===========================================
# Multi-stage Dockerfile for Control Plane
# ===========================================

# --- Base stage ---
FROM node:18-alpine AS base
WORKDIR /app
RUN apk add --no-cache curl tini
COPY package*.json ./

# --- Dependencies stage ---
FROM base AS dependencies
RUN npm ci --only=production && cp -R node_modules /prod_node_modules
RUN npm ci

# --- Test stage ---
FROM dependencies AS test
COPY . .
ENV NODE_ENV=test
CMD ["npm", "test"]

# --- Development stage ---
FROM dependencies AS development
RUN npm install -g nodemon
COPY . .
ENV NODE_ENV=development
CMD ["nodemon", "server.js"]

# --- Production stage ---
FROM base AS production
ENV NODE_ENV=production
ENV PORT=3000

# Copy production dependencies only
COPY --from=dependencies /prod_node_modules ./node_modules

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p logs data backups certs \
    && chown -R node:node /app

# Use non-root user
USER node

# Expose ports
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:3000/health || exit 1

# Use tini for proper PID 1
ENTRYPOINT ["/sbin/tini", "--"]

# Start application
CMD ["node", "server.js"]
