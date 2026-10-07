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

# Your backend entry file is server.js
CMD ["node", "server.js"]