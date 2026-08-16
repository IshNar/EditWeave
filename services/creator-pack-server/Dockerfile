FROM node:24-alpine
WORKDIR /app
COPY release/creator-pack-catalog-lib.mjs /app/release/creator-pack-catalog-lib.mjs
COPY services/creator-pack-server/server.mjs /app/services/creator-pack-server/server.mjs
USER node
EXPOSE 8792
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8792/healthz || exit 1
CMD ["node", "services/creator-pack-server/server.mjs"]
