#
# The Fraud - single Fly.io app
# - Stage 1: build Vite React client
# - Stage 2: install server deps, copy client build into server/public, run Express+Socket.IO
#

FROM node:22-alpine AS client-build
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build


FROM node:22-alpine AS server
WORKDIR /app/server

ENV NODE_ENV=production
ENV PORT=8080

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/ ./
COPY --from=client-build /app/client/dist ./public

EXPOSE 8080
CMD ["node", "src/index.js"]

