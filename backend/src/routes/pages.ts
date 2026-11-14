import express from 'express';
import { query } from '../db';
import { verifyPassword, hashPassword } from '../auth';
import * as reports from '../reports';
import { money } from '../money';
import { closeYear } from '../services/yearEnd';
import { importOpeningBalances } from '../services/imports';

const router = express.Router();

function layout(content: string, title = 'Accounting'): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:32px;max-width:1000px;margin:auto}
    h1{font-size:24px} table{width:100%;border-collapse:collapse;background:#1e293b;border-radius:10px;overflow:hidden;margin:16px 0}
    th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #334155} th{color:#94a3b8;font-size:12px;text-transform:uppercase}
    td.num{text-align:right} .ok{color:#4ade80} .bad{color:#f87171} a{color:#38bdf8;text-decoration:none;margin-right:12px}
    .nav{margin-bottom:20px} .card{background:#1e293b;border-radius:10px;padding:14px;display:inline-block;margin:6px}
    .card .n{font-size:22px;font-weight:700;color:#38bdf8} .card .l{color:#94a3b8;font-size:12px}
    input,button,select{padding:8px 12px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;margin:4px}
    button{background:#38bdf8;color:#082f49;font-weight:700;cursor:pointer}
  </style></head><body>${content}</body></html>`;
}

function loginForm(error?: string): string {
  return layout(`<h1>Login</h1>
    ${error ? `<p class="bad">${error}</p>` : ''}
    <form method="post" action="/login">
      <input name="username" placeholder="Username" required><br>
      <input name="password" type="password" placeholder="Password" required><br>
      <button type="submit">Log in</button>
    </form>`, 'Login');
}

router.get('/login', (req, res) => {
  res.send(loginForm());
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const { rows } = await query('SELECT id, username, password_hash, role FROM users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.send(loginForm('Invalid username or password'));
    }
    (req as any).session.userId = user.id;
    (req as any).session.username = user.username;
    (req as any).session.role = user.role;
    return res.redirect('/');
  } catch (e) { return next(e); }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/', async (req, res, next) => {
  if (!(req as any).session.userId) return res.redirect('/login');
  try {
    const tb = await reports.trialBalance();
    const totalDebit = tb.reduce((s, r) => s.plus(r.debit), money(0));
    const totalCredit = tb.reduce((s, r) => s.plus(r.credit), money(0));
    const counts = await query(`
      SELECT (SELECT count(*) FROM accounts) accounts,
             (SELECT count(*) FROM journal_entries) entries,
             (SELECT count(*) FROM parties) parties,
             (SELECT count(*) FROM invoices) invoices,
             (SELECT count(*) FROM payments) payments`);
    const c = counts.rows[0];

    const rows = tb.map((r) =>
      `<tr><td>${r.code}</td><td>${r.name}</td><td>${r.debit.toFixed(2)}</td><td>${r.credit.toFixed(2)}</td></tr>`).join('');

    const html = layout(`
      <h1>Accounting System <span style="font-size:14px;color:#94a3b8">(Node.js + TypeScript)</span></h1>
      <div class="nav">
        <a href="/">Dashboard</a>
        <a href="/reports/pnl">P&amp;L</a>
        <a href="/reports/balance-sheet">Balance Sheet</a>
        <a href="/reports/cash-flow">Cash Flow</a>
        <a href="/reports/aged-receivables">AR Aging</a>
        <a href="/reports/aged-payables">AP Aging</a>
        <a href="/reports/vat-return">VAT</a>
        <a href="/reports/budget-variance">Budgets</a>
        <a href="/reports/general-ledger">Ledger</a>
        <a href="/reports/account-ledger">Account</a>
        <a href="/reports/party-statement">Party</a>
        <a href="/reports/financial-ratios">Ratios</a>
        <a href="/reports/by-department">By Dept</a>
        <a href="/reports/fixed-assets">Assets</a>
        <a href="/reports/comparative-pl">Compare</a>
        <a href="/reports/equity-changes">Equity</a>
        <a href="/reports/inventory">Inventory</a>
        <a href="/reports/bank-reconciliation">Bank Rec</a>
        <a href="/recurring-entries">Recurring</a>
        <a href="/year-end-close">Year-End</a>
        <a href="/orders">Orders</a>
        <a href="/credit-notes">Notes</a>
        <a href="/audit-log">Audit</a>
        <a href="/prepayments">Prepay</a>
        <a href="/attachments">Files</a>
        <a href="/import">Import</a>
        <a href="/users">Users</a>
        <a href="/crm">CRM</a>
        <a href="/boms">BOMs</a>
        <a href="/production-orders">Production</a>
        <a href="/logout">Logout (${(req as any).session.username})</a>
      </div>
      <div>
        <div class="card"><div class="n">${c.accounts}</div><div class="l">Accounts</div></div>
        <div class="card"><div class="n">${c.entries}</div><div class="l">Entries</div></div>
        <div class="card"><div class="n">${c.parties}</div><div class="l">Parties</div></div>
        <div class="card"><div class="n">${c.invoices}</div><div class="l">Invoices</div></div>
        <div class="card"><div class="n">${c.payments}</div><div class="l">Payments</div></div>
      </div>
      <h2 style="color:#38bdf8;font-size:16px">Trial Balance</h2>
      <table><tr><th>Code</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr>
      ${rows}
      <tr><td colspan="2"><b>Total</b></td><td class="num"><b>${totalDebit.toFixed(2)}</b></td><td class="num"><b>${totalCredit.toFixed(2)}</b></td></tr></table>
      <p class="${totalDebit.equals(totalCredit) ? 'ok' : 'bad'}">${totalDebit.equals(totalCredit) ? '✓ Debits = Credits' : '⚠ Out of balance'}</p>`);
    res.send(html);
  } catch (e) { return next(e); }
});

function reportPage(title: string, rowsHtml: string): string {
  return layout(`<h1>${title}</h1><div class="nav"><a href="/">← Dashboard</a></div>${rowsHtml}`, title);
}

router.get('/reports/pnl', async (req, res, next) => {
  try {
    const d = await reports.profitAndLoss(req.query.start as string, req.query.end as string);
    const rev = d.revenue.map((r: any) => `<tr><td>${r.code} ${r.name}</td><td class="num">${r.amount.toFixed(2)}</td></tr>`).join('');
    const exp = d.expense.map((r: any) => `<tr><td>${r.code} ${r.name}</td><td class="num">${r.amount.toFixed(2)}</td></tr>`).join('');
    res.send(reportPage('Profit & Loss', `
      <h2 style="color:#38bdf8;font-size:16px">Revenue</h2><table><tr><th>Account</th><th class="num">Amount</th></tr>${rev}<tr><td><b>Total Revenue</b></td><td class="num"><b>${d.totalRevenue.toFixed(2)}</b></td></tr></table>
      <h2 style="color:#38bdf8;font-size:16px">Expenses</h2><table><tr><th>Account</th><th class="num">Amount</th></tr>${exp}<tr><td><b>Total Expenses</b></td><td class="num"><b>${d.totalExpense.toFixed(2)}</b></td></tr></table>
      <p><b>Net Income:</b> ${d.netIncome.toFixed(2)}</p>`));
  } catch (e) { next(e); }
});

router.get('/reports/balance-sheet', async (req, res, next) => {
  try {
    const d = await reports.balanceSheet(req.query.as_of as string);
    const sec = (rows: any[]) => rows.map((r) => `<tr><td>${r.code} ${r.name}</td><td class="num">${r.amount.toFixed(2)}</td></tr>`).join('');
    res.send(reportPage('Balance Sheet', `
      <h2 style="color:#38bdf8;font-size:16px">Assets</h2><table><tr><th>Account</th><th class="num">Amount</th></tr>${sec(d.assets)}<tr><td><b>Total</b></td><td class="num"><b>${d.totalAssets.toFixed(2)}</b></td></tr></table>
      <h2 style="color:#38bdf8;font-size:16px">Liabilities</h2><table><tr><th>Account</th><th class="num">Amount</th></tr>${sec(d.liabilities)}<tr><td><b>Total</b></td><td class="num"><b>${d.totalLiabilities.toFixed(2)}</b></td></tr></table>
      <h2 style="color:#38bdf8;font-size:16px">Equity</h2><table><tr><th>Account</th><th class="num">Amount</th></tr>${sec(d.equity)}<tr><td><b>Total</b></td><td class="num"><b>${d.totalEquity.toFixed(2)}</b></td></tr></table>
      <p class="${d.balanced ? 'ok' : 'bad'}">${d.balanced ? '✓ Assets = Liabilities + Equity' : '⚠ Not balanced'}</p>`));
  } catch (e) { next(e); }
});

router.get('/reports/cash-flow', async (req, res, next) => {
  try {
    const d = await reports.cashFlow(req.query.start as string, req.query.end as string);
    res.send(reportPage('Cash Flow', `
      <table><tr><th>Item</th><th class="num">Amount</th></tr>
      <tr><td>Net income</td><td class="num">${d.netIncome.toFixed(2)}</td></tr>
      <tr><td>Working capital change</td><td class="num">${d.workingCapitalChange.toFixed(2)}</td></tr>
      <tr><td><b>Operating</b></td><td class="num"><b>${d.operatingCashFlow.toFixed(2)}</b></td></tr>
      <tr><td><b>Financing</b></td><td class="num"><b>${d.financingCashFlow.toFixed(2)}</b></td></tr>
      <tr><td><b>Net change</b></td><td class="num"><b>${d.netChange.toFixed(2)}</b></td></tr></table>
      <p class="${d.reconciled ? 'ok' : 'bad'}">${d.reconciled ? '✓ Reconciles' : '⚠ Does not reconcile'}</p>`));
  } catch (e) { next(e); }
});

async function agingPage(req: express.Request, res: express.Response, next: express.NextFunction, type: string, title: string): Promise<void> {
  try {
    const asOf = (req.query.as_of as string) || new Date().toISOString().slice(0, 10);
    const rows = type === 'receivables' ? await reports.agedReceivables(asOf) : await reports.agedPayables(asOf);
    const html = rows.map((r: any) =>
      `<tr><td>${r.party}</td><td class="num">${r.current.toFixed(2)}</td><td class="num">${r.b31_60.toFixed(2)}</td><td class="num">${r.b61_90.toFixed(2)}</td><td class="num">${r.b90_plus.toFixed(2)}</td><td class="num"><b>${r.total.toFixed(2)}</b></td></tr>`).join('');
    res.send(reportPage(title, `<table><tr><th>Party</th><th class="num">0-30</th><th class="num">31-60</th><th class="num">61-90</th><th class="num">90+</th><th class="num">Total</th></tr>${html || '<tr><td colspan="6">Nothing outstanding</td></tr>'}</table>`));
  } catch (e) { next(e); }
}

router.get('/reports/aged-receivables', (req, res, next) => agingPage(req, res, next, 'receivables', 'Aged Receivables'));
router.get('/reports/aged-payables', (req, res, next) => agingPage(req, res, next, 'payables', 'Aged Payables'));

router.get('/reports/vat-return', async (req, res, next) => {
  try {
    const d = await reports.vatReturn(req.query.start as string, req.query.end as string);
    res.send(reportPage('VAT Return', `<table><tr><th>Item</th><th class="num">Amount</th></tr>
      <tr><td>Output VAT</td><td class="num">${d.outputVat.toFixed(2)}</td></tr>
      <tr><td>Input VAT</td><td class="num">${d.inputVat.toFixed(2)}</td></tr>
      <tr><td><b>Net VAT payable</b></td><td class="num"><b>${d.netVat.toFixed(2)}</b></td></tr></table>`));
  } catch (e) { next(e); }
});

router.get('/reports/budget-variance', async (req, res, next) => {
  try {
    const rows = await reports.budgetVariance(req.query.start as string, req.query.end as string);
    const html = rows.map((r: any) => `<tr><td>${r.account} ${r.name}</td><td class="num">${r.budgetAmount.toFixed(2)}</td><td class="num">${r.actual.toFixed(2)}</td><td class="num">${r.variance.toFixed(2)}</td></tr>`).join('');
    res.send(reportPage('Budget Variance', `<table><tr><th>Account</th><th class="num">Budget</th><th class="num">Actual</th><th class="num">Variance</th></tr>${html || '<tr><td colspan="4">No budgets</td></tr>'}</table>`));
  } catch (e) { next(e); }
});

router.get('/reports/general-ledger', async (req, res, next) => {
  try {
    const entries = await reports.generalLedger(req.query.start as string, req.query.end as string);
    let html = '';
    for (const e of entries) {
      const lines = e.lines.map((l: any) =>
        `<tr><td>${l.accountCode} ${l.accountName}</td><td class="num">${l.lineType === 'debit' ? l.amount.toFixed(2) : ''}</td><td class="num">${l.lineType === 'credit' ? l.amount.toFixed(2) : ''}</td></tr>`).join('');
      html += `<table><tr><th colspan="3">${e.date} · ${e.reference} · ${e.description}</th></tr><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr>${lines}</table>`;
    }
    res.send(reportPage('General Ledger', html || '<p>No entries</p>'));
  } catch (e) { next(e); }
});

router.get('/reports/account-ledger', async (req, res, next) => {
  try {
    const accounts = (await query('SELECT code, name FROM accounts WHERE is_active = TRUE ORDER BY code')).rows;
    const code = req.query.account as string;
    let table = '<p>Select an account.</p>';
    if (code) {
      const d = await reports.accountLedger(code, req.query.start as string, req.query.end as string);
      const rows = d.rows.map((r: any) => `<tr><td>${r.date}</td><td>${r.reference}</td><td>${r.description}</td><td class="num">${r.debit.toFixed(2)}</td><td class="num">${r.credit.toFixed(2)}</td><td class="num"><b>${r.balance.toFixed(2)}</b></td></tr>`).join('');
      table = `<table><tr><th>Date</th><th>Ref</th><th>Desc</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr>${rows || '<tr><td colspan="6">No activity</td></tr>'}</table><p>Closing balance: <b>${d.closingBalance.toFixed(2)}</b></p>`;
    }
    const options = accounts.map((a: any) => `<option value="${a.code}" ${a.code === code ? 'selected' : ''}>${a.code} ${a.name}</option>`).join('');
    res.send(reportPage('Account Ledger', `<form method="get"><select name="account"><option value="">-- select --</option>${options}</select> <button>View</button></form>${table}`));
  } catch (e) { next(e); }
});

router.get('/reports/party-statement', async (req, res, next) => {
  try {
    const parties = (await query('SELECT id, name FROM parties ORDER BY name')).rows;
    const id = req.query.party as string;
    let body = '<p>Select a party.</p>';
    if (id) {
      const d = await reports.partyStatement(Number(id), req.query.start as string, req.query.end as string);
      const inv = d.invoices.map((i: any) => `<tr><td>${i.invoice_number}</td><td>${i.issue_date}</td><td>${i.invoice_type}</td><td class="num">${Number(i.total).toFixed(2)}</td><td>${i.status}</td></tr>`).join('');
      const pay = d.payments.map((p: any) => `<tr><td>${p.payment_date}</td><td>${p.direction}</td><td>${p.method}</td><td class="num">${Number(p.amount).toFixed(2)}</td></tr>`).join('');
      body = `<h2 style="color:#38bdf8;font-size:16px">Invoices</h2><table><tr><th>Number</th><th>Date</th><th>Type</th><th class="num">Total</th><th>Status</th></tr>${inv || '<tr><td colspan="5">None</td></tr>'}</table>
        <h2 style="color:#38bdf8;font-size:16px">Payments</h2><table><tr><th>Date</th><th>Dir</th><th>Method</th><th class="num">Amount</th></tr>${pay || '<tr><td colspan="4">None</td></tr>'}</table>
        <p>Balance: <b>${d.balance.toFixed(2)}</b></p>`;
    }
    const options = parties.map((p: any) => `<option value="${p.id}" ${String(p.id) === id ? 'selected' : ''}>${p.name}</option>`).join('');
    res.send(reportPage('Party Statement', `<form method="get"><select name="party"><option value="">-- select --</option>${options}</select> <button>View</button></form>${body}`));
  } catch (e) { next(e); }
});

router.get('/reports/financial-ratios', async (req, res, next) => {
  try {
    const d = await reports.financialRatios(req.query.as_of as string);
    const pct = (v: any) => (v === null ? '—' : v.times(100).toFixed(2) + '%');
    const ratio = (v: any) => (v === null ? '—' : v.toFixed(2));
    res.send(reportPage('Financial Ratios', `<table><tr><th>Metric</th><th class="num">Value</th></tr>
      <tr><td>Revenue</td><td class="num">${d.revenue.toFixed(2)}</td></tr>
      <tr><td>Gross Profit</td><td class="num">${d.grossProfit.toFixed(2)}</td></tr>
      <tr><td>Gross Margin</td><td class="num">${pct(d.grossMargin)}</td></tr>
      <tr><td>Net Income</td><td class="num">${d.netIncome.toFixed(2)}</td></tr>
      <tr><td>Net Margin</td><td class="num">${pct(d.netMargin)}</td></tr>
      <tr><td>Current Ratio</td><td class="num">${ratio(d.currentRatio)}</td></tr>
      <tr><td>Return on Equity</td><td class="num">${pct(d.returnOnEquity)}</td></tr></table>`));
  } catch (e) { next(e); }
});

router.get('/reports/by-department', async (req, res, next) => {
  try {
    const rows = await reports.profitAndLossByDepartment(req.query.start as string, req.query.end as string);
    const html = rows.map((r: any) => `<tr><td>${r.department}</td><td class="num">${r.revenue.toFixed(2)}</td><td class="num">${r.expense.toFixed(2)}</td><td class="num"><b>${r.netIncome.toFixed(2)}</b></td></tr>`).join('');
    res.send(reportPage('P&L by Department', `<table><tr><th>Department</th><th class="num">Revenue</th><th class="num">Expense</th><th class="num">Net Income</th></tr>${html || '<tr><td colspan="4">No departmental data — tag journal lines with a department</td></tr>'}</table>`));
  } catch (e) { next(e); }
});

router.get('/reports/fixed-assets', async (req, res, next) => {
  try {
    const d = await reports.fixedAssetRegister(req.query.as_of as string);
    const html = d.assets.map((r: any) => `<tr><td>${r.name}</td><td>${r.accountCode} ${r.accountName}</td><td>${r.purchaseDate}</td><td class="num">${r.cost.toFixed(2)}</td><td class="num">${r.annualDepreciation.toFixed(2)}</td><td class="num">${r.accumulatedDepreciation.toFixed(2)}</td><td class="num"><b>${r.netBookValue.toFixed(2)}</b></td></tr>`).join('');
    res.send(reportPage('Fixed Asset Register', `<table><tr><th>Asset</th><th>Account</th><th>Purchased</th><th class="num">Cost</th><th class="num">Annual Dep.</th><th class="num">Accum. Dep.</th><th class="num">Net Book Value</th></tr>${html || '<tr><td colspan="7">No fixed assets</td></tr>'}<tr><td colspan="3"><b>Total</b></td><td class="num"><b>${d.totalCost.toFixed(2)}</b></td><td></td><td class="num"><b>${d.totalAccumulated.toFixed(2)}</b></td><td class="num"><b>${d.totalNetBookValue.toFixed(2)}</b></td></tr></table>`));
  } catch (e) { next(e); }
});

router.get('/reports/comparative-pl', async (req, res, next) => {
  try {
    const start = (req.query.start as string) || '2026-01-01';
    const end = (req.query.end as string) || new Date().toISOString().slice(0, 10);
    const d = await reports.comparativeProfitAndLoss(start, end);
    res.send(reportPage('Comparative P&L', `<p>Current: ${d.currentStart} → ${d.currentEnd} &nbsp;|&nbsp; Prior: ${d.priorStart} → ${d.priorEnd}</p>
      <table><tr><th>Metric</th><th class="num">Current</th><th class="num">Prior</th><th class="num">Variance</th></tr>
      <tr><td>Revenue</td><td class="num">${d.currentRevenue.toFixed(2)}</td><td class="num">${d.priorRevenue.toFixed(2)}</td><td class="num">${d.revenueVariance.toFixed(2)}</td></tr>
      <tr><td>Expenses</td><td class="num">${d.currentExpense.toFixed(2)}</td><td class="num">${d.priorExpense.toFixed(2)}</td><td class="num">${d.expenseVariance.toFixed(2)}</td></tr>
      <tr><td><b>Net Income</b></td><td class="num"><b>${d.currentNetIncome.toFixed(2)}</b></td><td class="num"><b>${d.priorNetIncome.toFixed(2)}</b></td><td class="num"><b>${d.netIncomeVariance.toFixed(2)}</b></td></tr></table>`));
  } catch (e) { next(e); }
});

router.get('/reports/equity-changes', async (req, res, next) => {
  try {
    const d = await reports.changesInEquity(req.query.start as string, req.query.end as string);
    res.send(reportPage('Statement of Changes in Equity', `<table><tr><th>Item</th><th class="num">Amount</th></tr>
      <tr><td>Opening equity</td><td class="num">${d.openingEquity.toFixed(2)}</td></tr>
      <tr><td>Capital movements</td><td class="num">${d.capitalMovements.toFixed(2)}</td></tr>
      <tr><td>Net income for period</td><td class="num">${d.netIncome.toFixed(2)}</td></tr>
      <tr><td><b>Closing equity</b></td><td class="num"><b>${d.closingEquity.toFixed(2)}</b></td></tr></table>
      <p class="${d.reconciled ? 'ok' : 'bad'}">${d.reconciled ? '✓ Reconciles' : '⚠ Does not reconcile'}</p>`));
  } catch (e) { next(e); }
});

router.get('/reports/inventory', async (req, res, next) => {
  try {
    const rows = await reports.inventoryValuation();
    const html = rows.map((r: any) => `<tr><td>${r.sku}</td><td>${r.name}</td><td>${r.unit}</td><td class="num">${r.quantity.toFixed(2)}</td><td class="num">${r.averageCost.toFixed(2)}</td><td class="num"><b>${r.totalValue.toFixed(2)}</b></td></tr>`).join('');
    res.send(reportPage('Inventory Valuation (Moving Average)', `<table><tr><th>SKU</th><th>Item</th><th>Unit</th><th class="num">Qty</th><th class="num">Avg Cost</th><th class="num">Value</th></tr>${html || '<tr><td colspan="6">No inventory items</td></tr>'}</table>`));
  } catch (e) { next(e); }
});

router.get('/reports/bank-reconciliation', async (req, res, next) => {
  try {
    const accounts = (await query("SELECT code, name FROM accounts WHERE code IN ('1000','1005','1010') AND is_active = TRUE ORDER BY code")).rows;
    const code = req.query.account as string;
    let body = '<p>Select a bank/cash account.</p>';
    if (code) {
      const d = await reports.bankReconciliation(code, req.query.as_of as string);
      const glRows = d.unmatchedGL.map((t: any) => `<tr><td>${t.date}</td><td>${t.reference}</td><td>${t.description}</td><td class="num">${t.amount.toFixed(2)}</td></tr>`).join('');
      const stmtRows = d.unmatchedStatement.map((t: any) => `<tr><td>${t.date}</td><td>${t.reference}</td><td>${t.description}</td><td class="num">${t.amount.toFixed(2)}</td></tr>`).join('');
      body = `<p><b>GL balance:</b> ${d.glBalance.toFixed(2)} &nbsp;|&nbsp; <b>Statement:</b> ${d.statementBalance.toFixed(2)} &nbsp;|&nbsp; <b>Difference:</b> ${d.difference.toFixed(2)} &nbsp;|&nbsp; Matched: ${d.matchedCount}</p>
        <h2 style="color:#38bdf8;font-size:16px">In books, not in statement (${d.unmatchedGL.length})</h2><table><tr><th>Date</th><th>Ref</th><th>Desc</th><th class="num">Amount</th></tr>${glRows || '<tr><td colspan="4">None</td></tr>'}</table>
        <h2 style="color:#38bdf8;font-size:16px">In statement, not in books (${d.unmatchedStatement.length})</h2><table><tr><th>Date</th><th>Ref</th><th>Desc</th><th class="num">Amount</th></tr>${stmtRows || '<tr><td colspan="4">None</td></tr>'}</table>`;
    }
    const options = accounts.map((a: any) => `<option value="${a.code}" ${a.code === code ? 'selected' : ''}>${a.code} ${a.name}</option>`).join('');
    res.send(reportPage('Bank Reconciliation', `<form method="get"><select name="account"><option value="">-- select --</option>${options}</select> <button>Reconcile</button></form>${body}`));
  } catch (e) { next(e); }
});

router.get('/recurring-entries', async (req, res, next) => {
  try {
    const rows = (await query('SELECT * FROM recurring_entries ORDER BY next_run_date, id')).rows;
    const html = rows.map((r: any) => `<tr><td>${r.id}</td><td>${r.description}</td><td>${r.frequency}</td><td>${r.next_run_date}</td><td>${r.is_active ? 'active' : 'paused'}</td></tr>`).join('');
    res.send(reportPage('Recurring Entries', `<p>Post via <code>POST /api/actions/process-recurring</code>. Create via <code>POST /api/recurring-entries</code>.</p><table><tr><th>ID</th><th>Description</th><th>Frequency</th><th>Next Run</th><th>Status</th></tr>${html || '<tr><td colspan="5">No recurring entries</td></tr>'}</table>`));
  } catch (e) { next(e); }
});

router.get('/year-end-close', async (req, res, next) => {
  try {
    const closures = (await query('SELECT * FROM year_end_closures ORDER BY year DESC')).rows;
    const html = closures.map((c: any) => `<tr><td>${c.year}</td><td class="num">${c.net_income}</td><td>${c.closed_at}</td></tr>`).join('');
    res.send(reportPage('Year-End Close', `<form method="post" action="/year-end-close"><input name="year" placeholder="Year (e.g. 2026)" value="2026"><button>Close Year</button></form>
      <p>Closes all revenue/expense accounts to Retained Earnings and locks the year.</p>
      <table><tr><th>Year</th><th class="num">Net Income</th><th>Closed At</th></tr>${html || '<tr><td colspan="3">No years closed yet</td></tr>'}</table>`));
  } catch (e) { next(e); }
});

router.post('/year-end-close', async (req, res, next) => {
  if ((req as any).session.role !== 'admin') {
    return res.send(reportPage('Year-End Close', '<p class="bad">Only admins can close the year.</p><a href="/year-end-close">← Back</a>'));
  }
  try {
    const year = Number(req.body.year);
    await closeYear(year);
    return res.redirect('/year-end-close');
  } catch (e: any) {
    return res.send(reportPage('Year-End Close', `<p class="bad">${e.message}</p><a href="/year-end-close">← Back</a>`));
  }
});

router.get('/orders', async (req, res, next) => {
  try {
    const rows = (await query('SELECT * FROM orders ORDER BY order_date DESC, id DESC')).rows;
    const html = rows.map((r: any) => `<tr><td>${r.order_number}</td><td>${r.order_type}</td><td>${r.order_date}</td><td>${r.status}</td><td class="num">${r.total}</td></tr>`).join('');
    res.send(reportPage('Orders', `<p>Create via <code>POST /api/orders</code>, convert to invoice via <code>POST /api/actions/convert-order</code>.</p><table><tr><th>Number</th><th>Type</th><th>Date</th><th>Status</th><th class="num">Total</th></tr>${html || '<tr><td colspan="5">No orders</td></tr>'}</table>`));
  } catch (e) { next(e); }
});

router.get('/credit-notes', async (req, res, next) => {
  try {
    const rows = (await query('SELECT * FROM credit_notes ORDER BY issue_date DESC, id DESC')).rows;
    const html = rows.map((r: any) => `<tr><td>${r.note_number}</td><td>${r.note_type}</td><td>${r.issue_date}</td><td>${r.reason || ''}</td><td class="num">${r.total}</td></tr>`).join('');
    res.send(reportPage('Credit / Debit Notes', `<p>Create via <code>POST /api/credit-notes</code>.</p><table><tr><th>Number</th><th>Type</th><th>Date</th><th>Reason</th><th class="num">Total</th></tr>${html || '<tr><td colspan="5">No notes</td></tr>'}</table>`));
  } catch (e) { next(e); }
});

router.get('/audit-log', async (req, res, next) => {
  try {
    const rows = (await query('SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 200')).rows;
    const html = rows.map((r: any) => `<tr><td>${r.created_at}</td><td>${r.username || ''}</td><td>${r.action}</td><td>${r.entity_type}${r.entity_id ? ' #' + r.entity_id : ''}</td></tr>`).join('');
    res.send(reportPage('Audit Log', `<table><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th></tr>${html || '<tr><td colspan="4">No activity yet</td></tr>'}</table>`));
  } catch (e) { next(e); }
});

router.get('/prepayments', async (req, res, next) => {
  try {
    const rows = (await query('SELECT * FROM prepayments ORDER BY start_date, id')).rows;
    const html = rows.map((r: any) => `<tr><td>${r.id}</td><td>${r.description}</td><td>${r.start_date}</td><td class="num">${r.total_amount}</td><td>${r.amortized_months}/${r.months}</td></tr>`).join('');
    res.send(reportPage('Prepayments', `<p>Create via <code>POST /api/prepayments</code>, amortize via <code>POST /api/actions/amortize-prepayments</code>.</p><table><tr><th>ID</th><th>Description</th><th>Start</th><th class="num">Total</th><th>Amortized</th></tr>${html || '<tr><td colspan="5">No prepayments</td></tr>'}</table>`));
  } catch (e) { next(e); }
});

router.get('/attachments', async (req, res, next) => {
  try {
    const rows = (await query('SELECT id, entity_type, entity_id, filename, content_type, created_at FROM attachments ORDER BY created_at DESC')).rows;
    const html = rows.map((r: any) => `<tr><td>${r.id}</td><td>${r.entity_type}${r.entity_id ? ' #' + r.entity_id : ''}</td><td>${r.filename}</td><td>${r.content_type}</td><td>${r.created_at}</td></tr>`).join('');
    res.send(reportPage('Attachments', `<p>Upload via <code>POST /api/attachments</code> (base64 content).</p><table><tr><th>ID</th><th>Entity</th><th>File</th><th>Type</th><th>When</th></tr>${html || '<tr><td colspan="5">No attachments</td></tr>'}</table>`));
  } catch (e) { next(e); }
});

router.get('/import', (req, res) => {
  res.send(reportPage('Import', `
    <h2 style="color:#38bdf8;font-size:16px">Opening balances (CSV: accountCode,debit,credit)</h2>
    <form method="post" action="/import"><input name="date" value="2026-01-01"> <label>date</label><br><textarea name="csv" rows="6" cols="40">accountCode,debit,credit
1000,50000,0
3000,0,50000</textarea><br><button>Import</button></form>`));
});

router.post('/import', async (req, res, next) => {
  try {
    await importOpeningBalances(req.body.csv, req.body.date);
    return res.redirect('/import');
  } catch (e: any) {
    return res.send(reportPage('Import', `<p class="bad">${e.message}</p><a href="/import">← Back</a>`));
  }
});

router.get('/users', async (req, res, next) => {
  if ((req as any).session.role !== 'admin') {
    return res.send(reportPage('Users', '<p class="bad">Only admins can manage users.</p><a href="/">← Dashboard</a>'));
  }
  try {
    const rows = (await query('SELECT id, username, role, created_at FROM users ORDER BY id')).rows;
    const html = rows.map((r: any) => `<tr><td>${r.id}</td><td>${r.username}</td><td>${r.role}</td><td>${r.created_at}</td></tr>`).join('');
    res.send(reportPage('User Management', `<form method="post" action="/users"><input name="username" placeholder="username" required><input name="password" type="password" placeholder="password" required><select name="role"><option>viewer</option><option>accountant</option><option>admin</option></select><button>Add User</button></form>
      <table><tr><th>ID</th><th>Username</th><th>Role</th><th>Created</th></tr>${html || '<tr><td colspan="4">No users</td></tr>'}</table>`));
  } catch (e) { next(e); }
});

router.post('/users', async (req, res, next) => {
  if ((req as any).session.role !== 'admin') return res.status(403).send('Forbidden');
  try {
    const { username, password, role } = req.body;
    const hash = await hashPassword(password);
    await query('INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3)', [username, hash, role]);
    return res.redirect('/users');
  } catch (e: any) {
    return res.send(reportPage('Users', `<p class="bad">${e.message}</p><a href="/users">← Back</a>`));
  }
});

router.get('/crm', async (req, res, next) => {
  try {
    const groups = (await query('SELECT * FROM party_groups ORDER BY name')).rows;
    const terms = (await query('SELECT * FROM payment_terms ORDER BY days, name')).rows;
    const g = groups.map((r: any) => `<tr><td>${r.id}</td><td>${r.name}</td><td>${r.description || ''}</td></tr>`).join('');
    const t = terms.map((r: any) => `<tr><td>${r.id}</td><td>${r.name}</td><td>${r.days}</td><td>${r.description || ''}</td></tr>`).join('');
    res.send(reportPage('CRM (Groups & Payment Terms)', `<h2 style="color:#38bdf8;font-size:16px">Party Groups</h2><table><tr><th>ID</th><th>Name</th><th>Description</th></tr>${g || '<tr><td colspan="3">None</td></tr>'}</table>
      <h2 style="color:#38bdf8;font-size:16px">Payment Terms</h2><table><tr><th>ID</th><th>Name</th><th>Days</th><th>Description</th></tr>${t || '<tr><td colspan="4">None</td></tr>'}</table>`));
  } catch (e) { next(e); }
});

router.get('/boms', async (req, res, next) => {
  try {
    const rows = (await query('SELECT * FROM boms ORDER BY id')).rows;
    const html = rows.map((r: any) => `<tr><td>${r.id}</td><td>${r.name}</td><td>${r.finished_item_id}</td><td>${r.created_at}</td></tr>`).join('');
    res.send(reportPage('Bills of Materials', `<p>Create via <code>POST /api/boms</code>.</p><table><tr><th>ID</th><th>Name</th><th>Finished Item</th><th>Created</th></tr>${html || '<tr><td colspan="4">No BOMs</td></tr>'}</table>`));
  } catch (e) { next(e); }
});

router.get('/production-orders', async (req, res, next) => {
  try {
    const rows = (await query('SELECT * FROM production_orders ORDER BY production_date DESC, id DESC')).rows;
    const html = rows.map((r: any) => `<tr><td>${r.id}</td><td>${r.bom_id}</td><td>${r.quantity}</td><td>${r.status}</td><td>${r.production_date}</td></tr>`).join('');
    res.send(reportPage('Production Orders', `<p>Create via <code>POST /api/production-orders</code>, produce via <code>POST /api/actions/produce-order</code>.</p><table><tr><th>ID</th><th>BOM</th><th>Qty</th><th>Status</th><th>Date</th></tr>${html || '<tr><td colspan="5">No orders</td></tr>'}</table>`));
  } catch (e) { next(e); }
});

export default router;
