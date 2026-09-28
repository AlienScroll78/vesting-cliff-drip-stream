# API Changelog

All notable changes to the Vesting Cliff Drip Stream backend API are documented here.
This file tracks OpenAPI spec changes, new endpoints, and breaking modifications.

---

## [1.1.0] — 2026-08-28

### Added

- **GET `/health`** — Liveness probe. Returns `{ status, version, uptime }`.
- **GET `/health/horizon`** — Horizon connectivity check. Returns `{ status, endpoints }`.
- **GET `/health/horizon/circuit-breaker`** — Circuit breaker state (plain text: `closed` / `open` / `half-open`).
- **GET `/api/openapi.json`** — Raw OpenAPI 3.0 spec as JSON.
- **GET `/api/v1/schedules`** — Paginated schedule list for authenticated sponsors. Requires JWT.
- **GET `/api/v1/schedules/export`** — CSV/JSON export of streams. Supports `from`/`to` date filtering.
- **GET `/api/v1/schedules/sponsor/{sponsor}`** — Legacy Horizon-based sponsor schedule lookup.
- **GET `/admin/indexer/status`** — Indexer health (admin, Basic Auth, internal only).
- **GET `/admin/metrics`** — Prometheus text metrics (admin, Basic Auth, internal only).
- **POST `/api/v1/admin/drain`** — Drain expired streams with optional dry-run.
- **GET `/api/v1/metrics`** — JSON operational metrics (cache hit rates).
- **WebSocket `/ws/claimable`** — Real-time claimable balance subscription.

### Changed

- API version bumped from `1.0.0` to `1.1.0`.
- OpenAPI spec expanded from 1 endpoint (`/api/v1/schedules/{recipient}`) to 13 endpoints.

### Breaking Changes

None. All new endpoints are additive. The existing `GET /api/v1/schedules/{recipient}` endpoint is unchanged.

### Notes

- Admin endpoints (`/admin/*`) are HTTP Basic Auth protected and intended for internal network access only — not exposed through public ingress.
- The `/api/v1/schedules` (paginated) endpoint requires a JWT where the `sub` claim matches the `sponsor` query parameter, preventing cross-sponsor data access.
- WebSocket protocol: connect, send `{"action":"subscribe","recipient":"G..."}`, receive periodic balance updates.

---

## [1.0.0] — 2026-06-03

### Initial Release

- **GET `/api/v1/schedules/{recipient}`** — Full vesting schedule with computed fields.
