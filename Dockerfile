
FROM node:20-alpine

# Install OpenSSL dependencies for Prisma
RUN apk add --no-cache openssl libssl3

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY prisma ./prisma
COPY src ./src

# Prisma client generation at build time
RUN npx prisma generate

ENV NODE_ENV=production
EXPOSE 8000

CMD ["sh", "-c", "npx prisma db push && node src/index.js"]
