FROM node:24-bookworm
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium && npm cache clean --force
COPY --chown=node:node api ./api
COPY --chown=node:node lib ./lib
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
ENV HOST=0.0.0.0 PORT=3108 DATA_DIR=/app/storage SCRAPER_BROWSER=chromium
EXPOSE 3108
CMD ["node", "api/server.js"]
