# Psychology Clinic SaaS API

Backend API for a multi-tenant psychology clinic platform built with NestJS + Prisma + PostgreSQL.

## Requirements

- Node.js 20+
- PostgreSQL 15+
- Redis 7+ (optional, only for reminders queue/scheduler)

## Quick start

1. Install dependencies:
```bash
npm ci
```

2. Configure environment:
```bash
cp .env.example .env
```

3. Generate Prisma client:
```bash
npm run prisma:generate
```

4. Apply migrations (if available):
```bash
npm run prisma:migrate
```

5. Run development server:
```bash
npm run start:dev
```

## Core endpoints

- API docs: `GET /api/v1/docs`
- Health check: `GET /health`
- Auth login: `POST /api/v1/auth/login`
  - Requires: `tenantSlug`, `email`, `password`

## Environment notes

- `THROTTLE_TTL` accepts seconds by default (e.g. `60`).
- `REDIS_ENABLED=true` enables scheduler + queue workers.
- CORS accepts `CORS_ORIGINS` (comma-separated), fallback is `FRONTEND_URL`.
- Invitation emails use optional webhook:
  - `EMAIL_API_URL`
  - `EMAIL_API_KEY`

## Scripts

- `npm run start:dev`: start with watch mode
- `npm run build`: production build
- `npm run lint`: ESLint
- `npm test`: unit tests
- `npm run test:e2e`: e2e tests
- `npm run prisma:generate`: Prisma client
- `npm run prisma:migrate`: create/apply dev migrations

## Docker

Development:
```bash
docker compose up --build
```

Production image:
```bash
docker build --target production -t psic-clinic-api:latest .
```

## CI

GitHub Actions workflow at `.github/workflows/ci.yml` runs:
- lint
- unit tests
- e2e tests
- build
