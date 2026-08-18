FROM node:22-alpine

WORKDIR /app
COPY --chown=node:node server.mjs /app/server.mjs
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    EDITWEAVE_CRASH_HOST=0.0.0.0 \
    EDITWEAVE_CRASH_PORT=8787 \
    EDITWEAVE_CRASH_DATA_DIR=/data

USER node
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "/app/server.mjs"]
