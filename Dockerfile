FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY astro.config.mjs server.mjs ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server.mjs ./
COPY public ./public
COPY --from=build /app/_site ./_site
RUN mkdir -p /var/lib/fractical && chown node:node /var/lib/fractical
USER node
ENV HOST=0.0.0.0 PORT=4173 FRACTICAL_DATA_DIR=/var/lib/fractical
EXPOSE 4173
CMD ["node", "server.mjs"]
