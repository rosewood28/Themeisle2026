# Submission
## Short Description

This submission implements a full-stack prediction market platform with:

- user authentication and role-based admin actions;
- market lifecycle management (active -> resolved -> archived);
- betting, payout distribution, balance tracking, leaderboard and profile bet history;
- paginated dashboards and dashboard updates via SSE (with polling fallback).

Stack:

- **Backend**: Bun + Elysia + Drizzle ORM + SQLite
- **Frontend**: React + TanStack Router + Tailwind + shadcn/ui
- **Runtime/Orchestration**: Docker Compose

---

## How To Run

### Docker (recommended)

From repository root:

```bash
docker compose up --build
```

Application URLs:

- Client: `http://localhost:3005`
- API: `http://localhost:4005`

### Admin bootstrap behavior

On container startup, server runs migrations and admin bootstrap automatically.

Default docker-compose admin credentials:

- Email: `admin@mail.com`
- Password: `admin123`

You can verify admins from server workspace:

```bash
cd server
bun run admin:show
```

---

## Feature Coverage By Task

### 1) Main Dashboard

- List active/resolved/archived markets
- Show title, outcomes, odds, total bet amount
- Sorting by creation date, total bet size or participants
- Pagination at 20 items/page with Previous/Next controls.
- Live updates:
  - **SSE stream** for market list updates
  - automatic fallback to 5s polling when stream fails.

### 2) User Profile

- Shows:
  - active bets (including current odds)
  - resolved bets (won/lost/refunded)
- Both sections paginated independently (20/page)

### 3) Market Detail

- Outcome odds and total market value
- Bet distribution chart
- Bet placement with positive amount validation

### 4) Leaderboard

- Ranks users by total winnings (descending)
- Pagination with Previous/Next (20/page)

### 5) Role System

- Users have role persisted in DB (`user` or `admin`).
- Admin-only controls for resolve and archive actions.

### 6) Admin Market Resolve + Archive

- **Resolve** (admin only):
  - allowed only for active markets
  - selects winning outcome
  - the total pool is distributed to the winners proportionally by their stake
  - market moves to resolved list
- **Archive** (admin only):
  - allowed only for resolved markets
  - market moves to archived page
  - refunds only when remaining undistributed funds exist
  (ex: nobody bets on the winning choice and the total pool is refunded to the bettors)

### 7) Payout Distribution

- On resolve:
  - compute winning bets,
  - distribute total pool proportionally by winning stake,
  - update user balances.

### 8) User Balance Tracking

- Initial balance defaults to 1000.
- Deduct when placing bets.
- Add winnings on resolve.
- Add refunds on archive (when applicable).
- Balance shown in UI and refreshed from server.

---

## Architecture & Design Choices

### API Design

- RESTful resource-based endpoints (`/api/auth`, `/api/markets`, `/api/markets/:id/...`).
- Correct verb usage (`GET`, `POST`) for retrieval and state transitions.
- Centralized framework-level error mapping (`code`, `message`) plus backward-compatible error handling for existing endpoint responses.

### Data Model

- Normalized schema:
  - users,
  - markets,
  - market_outcomes,
  - bets.
- Foreign keys and indexes used for common query paths (market lists, bets by market/user, leaderboard aggregation).

### Real-Time Strategy

- Adopted **SSE** for dashboard market updates:
  - simpler than WebSockets for one-way server-to-client streams,
  - better UX than hard refresh polling.
- Kept polling fallback for resilience when stream disconnects.

### Auth Strategy

- JWT auth via bearer token.
- Password hashing through Bun password utilities.
- Route-level authorization checks for admin-sensitive endpoints.

### Market Lifecycle Semantics

- Explicit statuses used in product semantics:
  - `active`,
  - `resolved`,
  - `archived`.
- Resolve and archive are separate admin actions to make payout/refund behavior explicit and auditable.

### UX Decisions

- Loading, empty, and error states across major pages.
- Confirmation dialogs for admin resolve/archive actions to prevent accidental destructive operations.
- Consistent button styling for admin actions.

---

## Key Files Updated (High-Level Map)

> Note: This is a curated map of core changes, not an exhaustive diff.

### Backend

- `server/src/api/handlers.ts`
  - market listing/filtering/sorting/pagination
  - profile/leaderboard logic
  - place-bet balance deduction
  - resolve/archive business rules
  - SSE streaming handler
- `server/src/api/markets.routes.ts`
  - routes + schemas for list/profile/leaderboard/resolve/archive/stream
- `server/src/api/auth.routes.ts`
  - auth endpoints + current user endpoint
- `server/src/middleware/auth.middleware.ts`
  - JWT user derivation for protected routes
- `server/src/db/schema.ts`
  - user role/balance and market status modeling
- `server/src/db/migrate.ts`
  - backfill migration logic for evolving schemas
- `server/src/db/seed.ts`
  - seeded users/markets/bets and initial admin seeding behavior
- `server/src/db/show-admin.ts` (added)
  - inspect current admins
- `server/src/db/promote-admin.ts` (added)
  - promote existing user to admin
- `server/src/db/bootstrap-admin.ts` (added)
  - startup admin bootstrap for Docker flows
- `server/docker-entrypoint.sh`
  - migrations, optional seeding, admin bootstrap on startup

### Frontend

- `client/src/lib/api.ts`
  - API types and client methods for new endpoints/features
- `client/src/lib/auth-context.tsx`
  - auth state persistence and user refresh/update behavior
- `client/src/routes/index.tsx`
  - dashboard filters/sort/pagination/SSE updates/admin controls/dialogs
- `client/src/routes/profile.tsx`
  - profile lists with pagination and live updates
- `client/src/routes/leaderboard.tsx`
  - leaderboard pagination
- `client/src/routes/markets/$id.tsx`
  - market detail, bet validation/chart/admin controls/dialogs
- `client/src/components/market-card.tsx`
  - market card display updates including archived state

### Infra

- `docker-compose.yml`
  - server/client services and env wiring
- `server/package.json`
  - db/admin utility scripts

---

## Testing & Validation Notes

- Manual end-to-end validation covered:
  - register/login/admin bootstrap
  - place bets and balance changes
  - resolve payouts and archive refunds
  - dashboard/profile/leaderboard pagination
  - role-protected admin routes
  - SSE updates + fallback behavior
- Linting was run for changed server/client files; repository may contain pre-existing unrelated lint warnings in untouched areas.

---

## Known Limitations / Future Improvements

- Move all endpoint errors to one strict uniform envelope (`code`, `message`, `details`) across every handler.
- Add stronger audit trail fields/events for market lifecycle transitions and balance mutations.
- Add comprehensive integration tests for resolve/archive edge cases and SSE behavior.

---

## Images or Video Demo

- Add screenshots or a short recording showing:
  - dashboard (active/resolved/archived + real-time updates),
  - market resolution/archive flow as admin,
  - profile and leaderboard pagination.