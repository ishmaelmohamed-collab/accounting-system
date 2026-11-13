# Accounting System

A double-entry accounting system built with **PostgreSQL** and **Django**.

Every financial event is recorded as a balanced journal entry (debits = credits),
enforced at the database level. The system provides invoices, payments, tax
handling, three financial statements, a REST API, and automated tests.

---

## Stack

| Layer | Technology |
|---|---|
| Database | PostgreSQL 17 (port `5433`) |
| Backend | Django 6.1 + Django REST Framework |
| Python | 3.15+ |
| Tests | pytest + pytest-django |
| Secrets | `.env` (gitignored) |

---

## Features

- **Chart of accounts** — asset / liability / equity / revenue / expense, with normal balances
- **Double-entry journal** — balanced entries enforced by database triggers; posted entries are immutable
- **Invoices** — sale & purchase, with line items, VAT, and automatic ledger posting
- **Payments** — incoming/outgoing, allocated to invoices, automatic ledger posting
- **Ledger hardening** — idempotency keys, entry reversals, fiscal-period locks
- **Budgets** — per-account budget amounts with actual-vs-budget variance
- **Reports** — Trial Balance, P&L, Balance Sheet, Cash Flow, AR/AP aging, VAT return, budget variance, general ledger, account ledger, party statements, financial ratios
- **REST API** — token-authenticated read + write endpoints
- **Server-rendered UI** — dashboard, entry forms, reports
- **Security** — secrets in env vars, HTTPS/HSTS hardening, rate limiting, least-privilege DB user

---

## Prerequisites

- PostgreSQL 17 installed and running on port `5433`
- Python 3.15+

---

## Setup

### 1. Create the database and user (one time, as the `postgres` superuser)

```sql
CREATE ROLE accounting_app WITH LOGIN PASSWORD 'your-strong-password' CREATEDB;
CREATE DATABASE accounting OWNER accounting_app;
```

### 2. Create a virtual environment and install dependencies

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Create your `.env` file

Copy the template and fill in real values:

```powershell
copy .env.example .env
```

`.env` must contain:

```ini
DJANGO_SECRET_KEY=<generate-one>
DJANGO_DEBUG=True
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
DB_NAME=accounting
DB_USER=accounting_app
DB_PASSWORD=<your-db-password>
DB_HOST=127.0.0.1
DB_PORT=5433
```

> Generate a secret key with:
> `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"`

### 4. Load the accounting schema (tables + triggers + seed chart of accounts)

```powershell
$env:PGPASSWORD = "<your-db-password>"
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -h 127.0.0.1 -p 5433 -U accounting_app -d accounting -f sql\001_core_schema.sql
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -h 127.0.0.1 -p 5433 -U accounting_app -d accounting -f sql\002_invoicing.sql
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -h 127.0.0.1 -p 5433 -U accounting_app -d accounting -f sql\003_ledger_hardening.sql
```

### 5. Run Django's own migrations + create an admin user

```powershell
python manage.py migrate
python manage.py createsuperuser
```

### 6. (Optional) Seed demo data

```powershell
python manage.py seed_demo
```

This creates 3 parties, 3 invoices, 2 payments, and 8 posted journal entries.

---

## Running

```powershell
.venv\Scripts\activate
python manage.py runserver
```

Then open **http://127.0.0.1:8000/**.

---

## Verification checklist

Work through these in order — every box should pass.

- [ ] **Dashboard** (`/`) — trial balance shows "✓ Debits = Credits"
- [ ] **Profit & Loss** (`/reports/profit-and-loss/`) — Net Income `25,000.00`
- [ ] **Balance Sheet** (`/reports/balance-sheet/`) — "✓ Assets = Liabilities + Equity"
- [ ] **Cash Flow** (`/reports/cash-flow/`) — "✓ Reconciles with the cash accounts"
- [ ] **New Invoice** (`/invoices/new/`) — creates an invoice and posts its entry
- [ ] **Record Payment** (`/payments/new/`) — records a payment and marks the invoice paid
- [ ] **Admin** (`/admin/`) — browse accounts, invoices, payments, fiscal periods
- [ ] **API** — `GET /api/trial-balance/` returns JSON; missing token returns 403
- [ ] **Tests** — `python -m pytest` shows `7 passed`

---

## Daily workflow

| Task | Where |
|---|---|
| Record a transaction | **New Invoice** / **Record Payment**, or `POST /api/actions/post-entry/` |
| Close a month | Admin → **Fiscal Periods** → add period, tick *is_closed* |
| See performance | **Profit & Loss**, **Balance Sheet**, **Cash Flow** |
| Fix a mistake | `POST /api/actions/reverse-entry/` (never edit a posted entry) |
| Customer balance | Trial balance + `party_id` in `journal_entry_lines` |

**Golden rule:** never edit a *posted* journal entry — reverse it and post a new one.

---

## Testing

```powershell
.venv\Scripts\python -m pytest
```

The suite creates a clean test database, loads the SQL migrations automatically,
and isolates each test in a transaction. It covers balanced posting, unbalanced
rejection, idempotency, period locks, reversals, cash-flow reconciliation, and
invoice auto-posting.

---

## API reference

All endpoints require authentication. Send `Authorization: Token <token>`.
Obtain a token via `POST /api/auth/token/` with `{"username": ..., "password": ...}`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/accounts/` | Chart of accounts |
| GET/POST | `/api/parties/` | Customers & vendors |
| GET | `/api/tax-rates/` | Tax rates |
| GET/POST | `/api/fiscal-periods/` | Fiscal periods (closing) |
| GET | `/api/journal-entries/` | Journal entries + lines |
| GET | `/api/invoices/` | Invoices + lines |
| GET | `/api/payments/` | Payments |
| GET | `/api/trial-balance/` | Trial balance |
| GET | `/api/reports/profit-and-loss/` | P&L (`?start=&end=`) |
| GET | `/api/reports/balance-sheet/` | Balance sheet (`?as_of=`) |
| GET | `/api/reports/cash-flow/` | Cash flow (`?start=&end=`) |
| GET | `/api/reports/aged-receivables/` | AR aging (`?as_of=`) |
| GET | `/api/reports/aged-payables/` | AP aging (`?as_of=`) |
| GET | `/api/reports/vat-return/` | VAT return (`?start=&end=`) |
| GET | `/api/reports/budget-variance/` | Budget vs actual (`?start=&end=`) |
| GET | `/api/reports/general-ledger/` | All posted entries (`?start=&end=`) |
| GET | `/api/reports/account-ledger/` | Running balance for one account (`?account=`) |
| GET | `/api/reports/party-statement/` | Invoices + payments for one party (`?party=`) |
| GET | `/api/reports/financial-ratios/` | Key ratios (`?as_of=`) |
| GET/POST | `/api/budgets/` | Budgets |
| POST | `/api/actions/post-entry/` | Post a balanced journal entry |
| POST | `/api/actions/create-invoice/` | Create + post an invoice |
| POST | `/api/actions/record-payment/` | Record + post a payment |
| POST | `/api/actions/reverse-entry/` | Reverse a posted entry |

---

## Project structure

```
accounting_project/          Django settings, URLs
ledger/
  models.py                  ORM models (managed=False)
  services.py                business rules (posting, invoices, payments, reversals)
  reports.py                 P&L, balance sheet, cash flow
  api.py                     REST API views
  serializers.py             API serializers
  forms.py                   entry forms
  views.py                   web views
  admin.py                   Django admin
  templates/ledger/          HTML pages
  management/commands/       seed_demo command
  tests.py                   pytest suite
sql/                         SQL migrations (001, 002, 003) + tests
conftest.py, pytest.ini      test configuration
.env.example                 environment template
requirements.txt             dependencies
```

---

## Security

- Secrets live in `.env` (gitignored) — never hardcoded in code
- All API endpoints require authentication (session or token)
- Rate limiting on the API (100/hour anon, 1000/hour authenticated)
- Production hardening (HTTPS redirect, HSTS, secure cookies) auto-enables when `DEBUG=False`
- The database user `accounting_app` is least-privilege (not a superuser)

> Keep `postgres-credentials.txt` and `.env` private. They are already in `.gitignore`.

---

## Production deployment

The project is production-ready: **gunicorn** (WSGI server), **whitenoise** (static files), and a `Dockerfile` + `docker-compose.yml` for a portable Linux deployment.

### Pre-deployment checklist

- [ ] `.env` has a strong `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=False`, and your real domain in `DJANGO_ALLOWED_HOSTS`
- [ ] `DJANGO_CSRF_TRUSTED_ORIGINS` lists your `https://` domain (e.g. `https://app.example.com`)
- [ ] Database password is strong and unique

### Option A — Docker (self-hosted on any Linux VPS)

1. Install Docker + Docker Compose on the server.
2. Copy the project and create a production `.env`.
3. Run:
   ```bash
   docker compose up -d --build
   ```
   This starts PostgreSQL (schema auto-loaded on first start) and the app behind gunicorn on port `8000`.
4. Put a reverse proxy (Nginx/Caddy) in front with HTTPS via Let's Encrypt.

### Option B — Platform-as-a-Service (easiest)

Render, Railway, or Fly.io can deploy this directly:

1. Push the project to a Git repo.
2. Create a **PostgreSQL** service and a **Web service**.
3. Build command: `pip install -r requirements.txt && python manage.py collectstatic --noinput`
4. Start command: `gunicorn accounting_project.wsgi:application --bind 0.0.0.0:$PORT`
5. Add the environment variables from `.env` (set `DB_HOST` to the platform's DB).

### Option C — Windows

gunicorn is Linux-only. On Windows, install `waitress` and run:
```bash
waitress-serve --listen=*:8000 accounting_project.wsgi:application
```

### Post-deployment

- [ ] Create an admin user: `python manage.py createsuperuser`
- [ ] Set up automated database backups
- [ ] Monitor logs and errors

## Next steps

1. **Build a frontend** — React/Vue/mobile consuming `/api/`.
2. **More accounting depth** — multi-currency, depreciation, payroll.
