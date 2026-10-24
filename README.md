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

All settings come from environment variables. `.env.example` lists every one with notes. In production, set them in your hosting platform. Local development reads them from `.env`.

**Required (the server refuses to start without these):**

| Variable | Notes |
|---|---|
| `MONGO_URI` | MongoDB connection string. Percent-encode special characters in the password (`@` becomes `%40`). |
| `JWT_SECRET` | Signs access tokens. Production: at least 32 characters. |
| `REFRESH_TOKEN_SECRET` | Signs refresh tokens. Must differ from `JWT_SECRET`. Production: at least 32 characters. |

**Required in production (`NODE_ENV=production`):**

| Variable | Notes |
|---|---|
| `NODE_ENV` | Set to `production`. |
| `FRONTEND_URL` | Allowed browser origin(s), comma-separated. |
| `RESEND_API_KEY` | Resend API key. |
| `RESEND_FROM` | Sender on a domain verified in Resend, e.g. `Biocap <noreply@example.org>`. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Image and document uploads. |

**Optional:**

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `5000` | Keep in step with the proxy or platform. |
| `SERVER_URL` | (same host) | Public API URL for Swagger "Try it out", if different from the docs host. |
| `TRUST_PROXY` | (none) | Number of proxy hops, so rate limits see real client IPs. |
| `REDIS_URL` | (none) | Shared cache and rate limits. Without it, per-process fallbacks are used. |
| `API_RATE_LIMIT_MAX` | `1000` | Requests per IP per 15 minutes across `/api`. |
| `JWT_EXPIRES_IN` | `7d` | Access-token lifetime. |
| `PASSWORD_EXPIRY_DAYS` | `90` | Days before a password must change. |
| `MAIL_FROM`, `MAIL_FROM_NAME` | (none) | Only used if `RESEND_FROM` is not set. |

Scripts only: `MONGODB_URI` (alias for `MONGO_URI`), `DRY_RUN` (see Tools).

**Startup behavior:** the server listens first, then retries MongoDB every 5 to 60 seconds. While the database is down, API calls return `503` with a clear message. `/health` reports database and Redis status.

## Running with Docker

```bash
docker compose up -d --build     # API on :5000 and Redis (MongoDB is the URL in MONGO_URI)
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
