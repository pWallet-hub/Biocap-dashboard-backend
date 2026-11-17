# Biocap Dashboard Backend

Express 5 + MongoDB API for the Biocap blog and dashboard. It serves the public news site, the
role-based dashboards (admin, communication officer, editor, content creator), editor proposals with
writer consent, uploads (Cloudinary), and transactional email (Resend).

Interactive API docs: **`/api-docs`** (Swagger UI). Raw OpenAPI JSON: **`/api-docs.json`**.

## Requirements

- Node.js 22 or newer
- MongoDB 6 or newer
- Redis 7 (optional, recommended when running more than one instance)
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
| `REDIS_URL` | (none) | Shared cache and rate limits (Redis). Without it, per-process memory is used. |
| `TRUST_PROXY` | (none) | Number of proxy hops, so rate limits see real client IPs. |
| `API_RATE_LIMIT_MAX` | `1000` | Requests per IP per 15 minutes across `/api`. |
| `JWT_EXPIRES_IN` | `7d` | Access-token lifetime. |
| `PASSWORD_EXPIRY_DAYS` | `90` | Days before a password must change. |
| `MAIL_FROM`, `MAIL_FROM_NAME` | (none) | Only used if `RESEND_FROM` is not set. |

Scripts only: `MONGODB_URI` (alias for `MONGO_URI`), `DRY_RUN` (see Tools).

**Startup behavior:** the server listens first, then retries MongoDB every 5 to 60 seconds. While the database is down, API calls return `503` with a clear message. `/health` reports database status, and Redis status for information only.

## Running with Docker

```bash
docker compose up -d --build     # API on :5000 and Redis (MongoDB is the URL in MONGO_URI)
curl http://localhost:5000/health
```

Secrets are read from `.env` and are never copied into the image (see `.dockerignore`).
`/health` returns 200 when the database is connected and 503 while it is not.
The container runs as the non-root `node` user and has a Docker health check.

For a single container without compose:

```bash
docker build -t biocap-backend .
docker run --env-file .env -p 5000:5000 biocap-backend
```

## Operations

- **Caching:** the public news list (first page, no filters) is cached for 60 seconds and cleared when articles change. The cache is shared through Redis when `REDIS_URL` is set; otherwise each instance keeps its own copy.
- **Rate limits:** `/api` is limited per IP. Login, registration, and password endpoints have a stricter limit (10 per 15 minutes). Counters are shared through Redis when `REDIS_URL` is set. Without Redis, each instance counts separately, so run one instance or enforce the limit at the proxy.
- **Shutdown:** on `SIGTERM` or `SIGINT` the server stops accepting connections, finishes in-flight requests, and closes the database and Redis connections.
- **Logs:** request logs use the `combined` format in production and `dev` otherwise.
- **Audit history:** successful user, authentication, blog workflow, comment moderation, and gallery changes are written to MongoDB before the API returns success. Audit write failures are logged and surfaced as request failures; because domain writes and audit records are not wrapped in a MongoDB transaction, an audit-storage outage can still occur after the domain change has committed. Records capture the actor snapshot, role, action, target, timestamp, and request metadata; secrets and request bodies are not recorded.

## Audit history API

The audit endpoints are admin-only and require the same bearer access token as other admin routes. They expose immutable action records for monitoring and accountability; these endpoints do not create or modify audit entries.

### Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/admin/audit-logs` | Search and paginate all recorded audit events. |
| `GET` | `/api/admin/audit-logs/user/:id` | Return actions performed on the user and actions performed by that user. |
| `GET` | `/api/admin/audit-logs/blog/:id` | Return the full recorded history for a blog. |
| `GET` | `/api/admin/audit-logs/gallery/:id` | Return paginated history for a gallery item. |
| `GET` | `/api/admin/dashboard` | Includes ten most recent audit events at `recentActivity.actions`; login activity remains at `recentActivity.lastLogins`. |

Interactive request and response documentation is also available from Swagger UI at `/api-docs`; the generated OpenAPI JSON is at `/api-docs.json`.

### Global audit-log filters

`GET /api/admin/audit-logs` accepts:

| Query parameter | Meaning |
|---|---|
| `action` | Exact action name, such as `user.create` or `blog.publish`. |
| `actor` | MongoDB ID of the person who performed the action. |
| `actorRole` | Role recorded at the time of the action. |
| `targetModel` | `User`, `Blog`, or `Gallery`. |
| `targetId` | MongoDB ID of the affected entity. |
| `from` / `to` | Inclusive ISO-8601 timestamp bounds. |
| `page` | 1-based page number; defaults to `1`. |
| `limit` | Entries per page; defaults to `20`, maximum `100`. |

Results are ordered newest first. Example:

```http
GET /api/admin/audit-logs?targetModel=User&action=user.create&page=1&limit=20
Authorization: Bearer <access-token>
```

The global and gallery endpoints return:

```json
{
  "data": [
    {
      "_id": "67a12345bc67890123456789",
      "actor": {
        "_id": "66a12345bc67890123456789",
        "username": "admin-user",
        "firstName": "Alice",
        "lastName": "Mukamana",
        "role": "admin"
      },
      "actorRole": "admin",
      "actorLabel": "admin-user",
      "action": "user.create",
      "targetModel": "User",
      "targetId": "66b98765dc43210987654321",
      "targetLabel": "jane.creator",
      "detail": { "createdByStaff": true, "role": "media_correspondent" },
      "ip": "192.0.2.10",
      "userAgent": "Mozilla/5.0",
      "requestMethod": "POST",
      "requestPath": "/api/admin/users",
      "timestamp": "2026-11-17T15:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPrevPage": false
  }
}
```

The user history endpoint groups results as `actionsOnThisUser` and `actionsPerformedByThisUser`. The blog history endpoint returns `{ "count": 1, "logs": [...] }`.

### Recorded action families

- **Accounts and authentication:** `user.create`, `user.update`, `user.role_change`, `user.deactivate`, `user.reactivate`, `user.delete`, `user.review`, `user.login`, `user.logout`, `user.password_change`, `user.password_reset`, and `user.password_reset_requested`.
- **Blogs and editorial workflow:** `blog.create`, `blog.update`, `blog.delete`, `blog.hard_delete`, `blog.restore`, `blog.submit`, `blog.review`, `blog.publish`, `blog.unpublish`, `blog.editor_proposal`, `blog.editor_proposal_notification`, `blog.editor_changes_accepted`, `blog.editor_changes_rejected`, `blog.editor_proposal_withdrawn`, `blog.mark_change_implemented`, and `blog.accept_editor_changes`.
- **Comments:** `blog.comment_add`, `blog.comment_hide`, `blog.comment_unhide`, and `blog.comment_delete`.
- **Gallery:** `gallery.create`, `gallery.update`, `gallery.publish`, `gallery.unpublish`, and `gallery.delete`.

Each event records the actor ID when available, a durable actor label and role snapshot, action, target, timestamp, request method/path, IP address, and user agent. `detail` contains action-specific context such as changed field names or a review decision. Passwords, tokens, and full request bodies are deliberately excluded. Public guest comments are represented with an anonymous actor snapshot; the commenter’s email and phone are not copied into the audit event.

Audit history is available only for events captured after the corresponding logging was added; missing past events cannot be reconstructed. Writes are awaited before a successful response is returned, but domain changes and audit records are not in a database transaction, so an audit-storage failure can happen after the original domain write has committed.

### Frontend admin audit page guide

Use the global endpoint as the data source for a searchable, paginated admin audit page. It returns one event array and pagination metadata, allowing the frontend to keep filters and page state without combining separate history responses.

#### Request patterns

Load the first page:

```http
GET /api/admin/audit-logs?page=1&limit=20
Authorization: Bearer <access-token>
```

Filter actions affecting a selected user:

```http
GET /api/admin/audit-logs?targetModel=User&targetId=<user-id>&page=1&limit=20
Authorization: Bearer <access-token>
```

Filter actions performed by a selected user, which may affect several entity types:

```http
GET /api/admin/audit-logs?actor=<user-id>&page=1&limit=20
Authorization: Bearer <access-token>
```

Filters can be combined and are ANDed. For example:
`targetModel=Blog&action=blog.publish&from=2026-11-01T00:00:00.000Z&to=2026-11-17T23:59:59.999Z`.
Use ISO-8601 timestamps with a timezone for `from` and `to`. Results are sorted newest first.
Reset `page` to `1` when filters change; use `pagination.hasNextPage` and `pagination.hasPrevPage` for navigation.

Example browser client:

```js
async function getAuditLogs({ apiBaseUrl, accessToken, filters = {}, page = 1, limit = 20 }) {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, value);
  }

  const response = await fetch(`${apiBaseUrl}/api/admin/audit-logs?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Could not load audit history (${response.status})`);
  return response.json();
}
```

Use the usual expired-session handling for `401` and show an access-denied state for `403`. Do not silently render an empty activity list when the request fails.

#### Rendering an event

| UI element | Source / behavior |
|---|---|
| Event title/badge | Map `action` to a human-readable label; fall back to the raw action for a newly added action. |
| Actor | Prefer populated `actor.firstName + actor.lastName`, then `actor.username`, then `actorLabel`, then `actorRole`. `actor` may be `null` for anonymous events or deleted accounts. |
| Actor role | Use `actorRole`, the role captured at the time of the event; do not infer it from the actor’s current account. |
| Target | Show `targetLabel` and `targetModel`. For a link, use `targetModel` and `targetId`; the target may have since been deleted. |
| Time | Parse `timestamp` as ISO-8601 and display in the viewer’s local timezone. Keep the original value for sorting/tooltips. |
| Change summary | Interpret known `detail` fields by action. `detail` is optional and variable; use a safe formatted fallback instead of assuming one shape. |
| Request metadata | `requestMethod`, `requestPath`, `ip`, and `userAgent` are optional. Put these in an expandable/secondary section rather than the primary event label. |

```js
function getActorName(event) {
  const fullName = [event.actor?.firstName, event.actor?.lastName].filter(Boolean).join(' ');
  return fullName || event.actor?.username || event.actorLabel || event.actorRole || 'Unknown actor';
}

function getTargetName(event) {
  return event.targetLabel || `${event.targetModel} (${event.targetId})`;
}
```

Render user-provided strings as text, never injected HTML. Action details can include editorial notes; do not inject them into the DOM as markup. Consider showing IP address and user-agent only in an expanded row available to authorized admins.

#### Action label and detail catalogue

`detail` is a flexible object. These are current fields that the UI may use for concise summaries; not every record contains every field:

| Action | Suggested label | Useful `detail` fields |
|---|---|---|
| `user.create` | User created | `createdByStaff`, `selfRegistration`, `role` |
| `user.update` | User profile updated | `updatedFields` |
| `user.role_change` | User role changed | `from`, `to` |
| `user.deactivate` / `user.reactivate` | Account deactivated / reactivated | — |
| `user.delete` | User deleted | `deletedUnpublishedBlogCount` |
| `user.review` | User profile reviewed | `decision`, `noteProvided` |
| `user.login` / `user.logout` | Signed in / signed out | — |
| `user.password_change` | Password changed | — |
| `user.password_reset` | Password reset | `source` may be `self_service`; staff resets may omit it |
| `user.password_reset_requested` | Password reset requested | — |
| `blog.create` | Blog created | — |
| `blog.update` | Blog updated | `updatedFields` |
| `blog.delete` / `blog.hard_delete` / `blog.restore` | Blog moved to trash / permanently deleted / restored | `blog.delete` may include `previousStatus` |
| `blog.submit` | Blog submitted for review | `resubmission` |
| `blog.review` | Blog reviewed | `decision` (`approved` or `rejected`) |
| `blog.publish` / `blog.unpublish` | Blog published / unpublished | `blog.unpublish` may include `note` |
| `blog.editor_proposal` | Editor proposed changes | `version`, `changes`, `writerNotified` |
| `blog.editor_proposal_notification` | Writer notified about proposal | `version`, `writerNotified` |
| `blog.editor_changes_accepted` / `blog.editor_changes_rejected` | Editor proposal accepted / rejected | `version`, optional `note` |
| `blog.editor_proposal_withdrawn` | Editor proposal withdrawn | `version` |
| `blog.mark_change_implemented` | Requested changes marked implemented | `changeId` may be available |
| `blog.accept_editor_changes` | Editor changes accepted by officer | — |
| `blog.comment_add` | Comment or review note added | `visibility` (`public` or `internal`), `isReply` for public comments |
| `blog.comment_hide` / `blog.comment_unhide` / `blog.comment_delete` | Comment hidden / shown / deleted | `commentId` |
| `gallery.create` | Gallery item created | `mediaType`, `category`; folder entries also include `imageCount` |
| `gallery.update` | Gallery item updated | `updatedFields` |
| `gallery.publish` / `gallery.unpublish` | Gallery item published / unpublished | — |
| `gallery.delete` | Gallery item deleted | `mediaType` |

Example summary: `user.role_change` can display “Alice changed jane.creator’s role from media_correspondent to editor”; `blog.update` can list the field names in `detail.updatedFields`. Do not assume events include before/after content diffs: audit records intentionally hold concise context, not full entity snapshots.

#### Entity history and dashboard widgets

- For paginated entity history, use the global endpoint with `targetModel` and `targetId`.
- `/api/admin/audit-logs/user/:id` currently returns two unpaginated arrays: `actionsOnThisUser` and `actionsPerformedByThisUser`. For filtering/pagination, use the global endpoint separately with `targetId` or `actor`.
- `/api/admin/audit-logs/blog/:id` returns `{ count, logs }` and is currently unpaginated; use the global endpoint when pagination is needed.
- `/api/admin/audit-logs/gallery/:id` returns the paginated `{ data, pagination }` shape.
- The dashboard provides only the latest ten events at `recentActivity.actions`; use the global endpoint for the full audit page.

The user and blog history responses have these exact top-level shapes:

```json
{
  "actionsOnThisUser": [{ "_id": "...", "action": "user.create", "actor": null, "actorLabel": "staff-user" }],
  "actionsPerformedByThisUser": [{ "_id": "...", "action": "blog.publish", "actor": { "_id": "...", "username": "jane" } }]
}
```

```json
{
  "count": 1,
  "logs": [{ "_id": "...", "action": "blog.publish", "targetModel": "Blog", "timestamp": "2026-11-17T15:00:00.000Z" }]
}
```

The blog response above is abbreviated; each log has the same audit fields as the global response. These history APIs do not include pagination. The dashboard response shape and audit schemas are also documented in Swagger.

The logger does not copy password/token request fields or entire request bodies. Some actions can include business notes in `detail` (for example an unpublish reason or editor decision note), so display those only to authorized admins and treat them as untrusted text. Public comments use an anonymous actor with the commenter’s display name where available; the commenter’s email, phone, and comment body are not copied into the audit event.

Audit history is available only for events captured after the corresponding logging was added; missing past events cannot be reconstructed. Writes are awaited before a successful response is returned, but domain changes and audit records are not in a database transaction, so an audit-storage failure can happen after the original domain write has committed.

## Tools

- `scripts/sendTestEmails.js <address>`: sends one example of each transactional email through the real Resend sender. Use `DRY_RUN=1` to render without sending.
- `scripts/seedAdmin.js`, `scripts/generateResetToken.js`, and the migration scripts in `scripts/`.

## Dependencies and verification notes

- `cloudinary` is on 2.x, and an npm override keeps `multer-storage-cloudinary` on the same version. `npm audit --omit=dev` reports 0 vulnerabilities. Upgrading `multer-storage-cloudinary` to 4.x again would bring back the vulnerable Cloudinary 1.x unless the override stays in place.
- Real Cloudinary uploads have not been exercised against a live account. Run one upload in staging after deployment.
- `node_modules/` is not tracked in git. Run `npm ci` after cloning.
