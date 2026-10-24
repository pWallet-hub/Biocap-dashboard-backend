# Biocap Dashboard Backend

Express 5 + MongoDB API for the Biocap blog and dashboard. It serves the public news site, the
role-based dashboards (admin, communication officer, editor, content creator), editor proposals with
writer consent, uploads (Cloudinary), and transactional email (Resend).

Interactive API docs: **`/api-docs`** (Swagger UI). Raw OpenAPI JSON: **`/api-docs.json`**.

## Requirements

- Node.js 22 or newer
- MongoDB 6 or newer
- Redis 7 (optional, recommended in production)
- A Resend account with a verified sending domain
- A Cloudinary account

## Setup

```bash
cp .env.example .env     # then fill in the values
npm ci
npm start                # or: npm run dev
npm test                 # unit tests
```

## Configuration

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | no | `production` enables stricter startup checks, CORS, and logging |
| `PORT` | no | default 5000 |
| `MONGO_URI` | yes | MongoDB connection string |
| `JWT_SECRET` | yes | at least 32 characters in production |
| `FRONTEND_URL` | production | allowed browser origin(s), comma-separated |
| `RESEND_API_KEY` | production | Resend API key |
| `RESEND_FROM` | production | sender on a domain verified in Resend, e.g. `Biocap <noreply@example.org>` |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | production | uploads |
| `REDIS_URL` | no | shared cache and rate limits; without it, per-process fallbacks are used |
| `TRUST_PROXY` | behind a proxy | number of proxy hops, so rate limits see real client IPs |
| `API_RATE_LIMIT_MAX` | no | requests per IP per 15 minutes across `/api` (default 1000) |

The server refuses to start when a required variable is missing.

## Running with Docker

```bash
docker compose up -d --build     # API on :5000, MongoDB, Redis
curl http://localhost:5000/health
```

Secrets are read from `.env` and are never copied into the image (see `.dockerignore`).
`/health` returns 200 when the database is connected, with Redis status reported separately.
The container runs as the non-root `node` user and has a Docker health check.

For a single container without compose:

```bash
docker build -t biocap-backend .
docker run --env-file .env -p 5000:5000 biocap-backend
```

## Operations

- **Caching:** the public news list (first page, no filters) is cached in Redis for 60 seconds and invalidated when articles change.
- **Rate limits:** `/api` is limited per IP. Login, registration, and password endpoints have a stricter limit (10 per 15 minutes). Counters live in Redis when it is configured. If Redis fails, requests are allowed through rather than blocked.
- **Shutdown:** on `SIGTERM` or `SIGINT` the server stops accepting connections, finishes in-flight requests, and closes the database and Redis connections.
- **Logs:** request logs use the `combined` format in production and `dev` otherwise.

## Tools

- `scripts/sendTestEmails.js <address>`: sends one example of each transactional email through the real Resend sender. Use `DRY_RUN=1` to render without sending.
- `scripts/seedAdmin.js`, `scripts/generateResetToken.js`, and the migration scripts in `scripts/`.

## Dependencies and verification notes

- `cloudinary` is on 2.x, and an npm override keeps `multer-storage-cloudinary` on the same version. `npm audit --omit=dev` reports 0 vulnerabilities. Upgrading `multer-storage-cloudinary` to 4.x again would bring back the vulnerable Cloudinary 1.x unless the override stays in place.
- Real Cloudinary uploads have not been exercised against a live account. Run one upload in staging after deployment.
- `node_modules/` is not tracked in git. Run `npm ci` after cloning.
