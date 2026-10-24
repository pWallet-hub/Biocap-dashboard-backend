FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies (cached unless package*.json changes)
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY . .

# Run as the built-in non-root "node" user
USER node
EXPOSE 5000

# Container health uses liveness (/health/live), so a database outage does not remove the container from the proxy.
# Readiness (/health/ready) reports database status for monitoring.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Your backend entry file is server.js
CMD ["node", "server.js"]