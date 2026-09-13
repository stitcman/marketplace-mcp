FROM node:22-alpine AS build
ARG GIT_COMMIT
RUN node -e "if (!/^[0-9a-fA-F]{40}$/.test(process.env.GIT_COMMIT ?? '')) { console.error('GIT_COMMIT must be a full 40-character hexadecimal Git SHA'); process.exit(1) }"
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ARG GIT_COMMIT
WORKDIR /app
ENV NODE_ENV=production
ENV MARKETPLACE_RUNTIME_ENV=production
ENV GIT_COMMIT=${GIT_COMMIT}
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY policies ./policies
COPY MARKETPLACE_MCP_MANIFEST.yaml ./MARKETPLACE_MCP_MANIFEST.yaml
COPY package.json ./
USER node
CMD ["node", "dist/index.js", "--http"]
