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

### Docker

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
  - market moves to archived view
  - refunds only when remaining undistributed funds exist
  (ex: nobody bets on the winning choice and the total pool is refunded to the bettors)

### 7) Payout Distribution

- On resolve:
  - compute winning bets
  - distribute total pool proportionally by winning stake
  - update winners balances

### 8) User Balance Tracking

- Initial balance of every user is 1000
- Deduct when placing bets
- Add winnings on resolve
- Add refunds on archive (when applicable)
- Balance shown in UI and refreshed from server

---

## Design Choices
- Protected admin routes to restrict sensitive actions
- Confirmation dialogs for admin resolve/archive actions to prevent accidental destructive operations
- Server-Sent Events (SSE) for dashboard market updates:
  - simpler than WebSockets for one-way server-to-client streams
  - improves user experience compared to periodic full refresh polling
- Kept polling fallback for when stream disconnects 