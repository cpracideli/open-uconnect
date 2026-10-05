# ─── Uconnect API + Dashboard ────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Sem dependências externas (package.json tem dependencies vazio),
# mas copiamos primeiro para aproveitar cache caso isso mude.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health-check || exit 1

CMD ["node", "server.js"]
