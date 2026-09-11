FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts is deliberate. better-sqlite3 13 ships a prebuilt .node for every
# platform in its tarball, but npm ci still fires an implicit `node-gyp rebuild` that
# this slim image has no Python or compiler for. Skipping scripts uses the prebuild.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server ./server
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /data && chown node:node /data
USER node
ENV PORT=3000 DATA_DIR=/data
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server/index.js"]
