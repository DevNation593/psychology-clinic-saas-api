FROM node:20-alpine AS base

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

FROM base AS development

RUN npm ci
COPY . .
RUN npx prisma generate

EXPOSE 3000
CMD ["npm", "run", "start:dev"]

FROM base AS builder

RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS production

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/main"]
