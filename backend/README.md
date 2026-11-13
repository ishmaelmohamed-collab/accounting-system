# Accounting Backend — Node.js + Express

A double-entry accounting backend. Reuses the existing PostgreSQL schema
(tables, triggers, constraints in `../sql/`) — only the application layer is
rewritten in Node.js.

## Stack

- **TypeScript 7** — static typing
- **Express 5** — web framework
- **pg** — PostgreSQL driver (raw SQL)
- **decimal.js** — exact money arithmetic
- **Zod** — input validation
- **express-session + connect-pg-simple** — session-cookie auth
- **bcryptjs** — password hashing
- **pino + pino-http** — structured logging
- **express-rate-limit** — API rate limiting
- **Vitest** — tests

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # tsc → dist/
npm run dev         # tsx watch (auto-reload)
```

CI runs `typecheck` + `test` on every push (see `../.github/workflows/ci.yml`).

## Run

```bash
npm install
npx tsx src/seed.ts admin <password>   # create a user (one time)
npm start                                # or: npm run dev (auto-reload)
```

Open http://localhost:8000/ — log in with the user you created.

## Config

Copy `.env.example` to `.env` and set:

- `PORT` (default 8000)
- `SESSION_SECRET`
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (points at PostgreSQL)

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Dashboard (trial balance) |
| GET/POST | `/login`, `/logout` | Session auth |
| POST | `/api/auth/login` | JSON login (API clients) |
| GET | `/api/accounts`, `/api/parties`, `/api/invoices`, `/api/payments`, `/api/journal-entries`, `/api/tax-rates` | Reads |
| POST | `/api/parties` | Create party |
| POST | `/api/actions/post-entry` | Post a balanced entry |
| POST | `/api/actions/create-invoice` | Create + post an invoice |
| POST | `/api/actions/record-payment` | Record + post a payment |
| POST | `/api/actions/reverse-entry` | Reverse a posted entry |
| GET | `/api/reports/*` | Trial balance, P&L, balance sheet, cash flow, aging, VAT, budgets, ledgers, ratios |

All `/api/*` routes (except `/api/auth`) require a session cookie.
