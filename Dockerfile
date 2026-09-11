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
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENV PORT=3000 DATA_DIR=/data
EXPOSE 3000
VOLUME ["/data"]
# Starts as root only to fix ownership of the /data mount, then drops to the
# node user. The app itself never runs as root. See docker-entrypoint.sh.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
