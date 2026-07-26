# Build and run the Property Management Assistant.
# Context is the repo root, so the app lives under ./app.

FROM node:22-alpine AS build
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/tsconfig.json ./
COPY app/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# index.js resolves these as ../public and ../fixtures from dist/
COPY app/public ./public
COPY app/fixtures ./fixtures

EXPOSE 3000
CMD ["node", "dist/index.js"]
