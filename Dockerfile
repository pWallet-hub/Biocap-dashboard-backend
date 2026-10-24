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

# Container health: the container is healthy while the app answers HTTP at all.
# Database status is reported on /health for monitoring, but it must not make the container unhealthy:
# an unhealthy container is removed from the proxy, which hides the app's own 503 message behind "no available server".
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health').then(()=>process.exit(0)).catch(()=>process.exit(1))"]

# Your backend entry file is server.js
CMD ["node", "server.js"]