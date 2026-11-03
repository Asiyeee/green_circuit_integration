FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
CMD ["node", "part2_price_disposal/scripts/price-daily.js", "run", "--apply", "--cloud"]
