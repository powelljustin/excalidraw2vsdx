# Official Node images publish linux/amd64 and linux/arm64, so this
# Dockerfile builds natively on Apple Silicon and on Intel.

FROM node:22-alpine AS build

WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:web

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    WEB_ROOT=/app/dist-web

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /src/dist ./dist
COPY --from=build /src/dist-web ./dist-web
COPY docker/serve.mjs ./serve.mjs
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["serve"]
