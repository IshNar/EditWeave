FROM node:22-alpine

WORKDIR /app
COPY --chown=node:node server.mjs /app/server.mjs

ENV NODE_ENV=production \
    EDITWEAVE_UPDATE_HOST=0.0.0.0 \
    EDITWEAVE_UPDATE_PORT=8790 \
    EDITWEAVE_UPDATE_CHANNEL_DIR=/channel

USER node
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=3s --start-period=10m --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8790/healthz || exit 1
CMD ["node", "/app/server.mjs"]
