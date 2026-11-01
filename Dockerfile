# Build the web UI, then run the API server, which also serves web/dist. Mock only.
# Node 26 only (rulebook). Docker on OrbStack, never Docker Desktop.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY core/package.json core/
COPY server/package.json server/
COPY web/package.json web/
# Only the web workspace's dependencies: the root devDependencies (Playwright, ajv) are not needed to build the UI.
# npm reaches the registry over IPv4 when IPv6 times out on the OrbStack network.
ENV NODE_OPTIONS="--network-family-autoselection --network-family-autoselection-attempt-timeout=500"
RUN npm ci -w web
COPY web web
RUN npm run build -w web

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production PTL_PORT=6211
COPY package.json package-lock.json ./
COPY core/package.json core/
COPY server/package.json server/
COPY web/package.json web/
ENV NODE_OPTIONS="--network-family-autoselection --network-family-autoselection-attempt-timeout=500"
RUN npm ci --omit=dev -w server -w core && npm cache clean --force
ENV NODE_OPTIONS=""
COPY core/src core/src
COPY server/src server/src
COPY server/data server/data
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 6211
# Inside the container the server listens on all interfaces (the container's own network namespace), so PTL_BIND is set here on purpose.
# docker-compose.yml publishes the port on 127.0.0.1 only; do not publish it more widely.
ENV PTL_BIND=0.0.0.0
CMD ["node", "server/src/index.js"]
