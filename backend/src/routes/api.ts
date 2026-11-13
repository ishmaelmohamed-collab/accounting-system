import express from 'express';
import { query } from '../db';
import { requireAuth } from '../auth';
import * as journal from '../services/journal';
import { createInvoice } from '../services/invoice';
import { recordPayment } from '../services/payment';
import { createRecurringEntry, processRecurringEntries } from '../services/recurring';
import { closeYear } from '../services/yearEnd';
import * as reports from '../reports';
import { validate, postEntrySchema, createInvoiceSchema, recordPaymentSchema, partySchema, reverseEntrySchema, departmentSchema, fixedAssetSchema, inventoryItemSchema, stockMovementSchema, bankTransactionSchema, recurringEntrySchema, closeYearSchema } from '../validation';

const router = express.Router();
router.use(requireAuth);

function handleError(res: express.Response, err: any): express.Response {
  const status = /balanced|closed|positive|not found|reversed|posted|no lines|zero|required/i.test(err.message) ? 400 : 500;
  return res.status(status).json({ error: err.message });
}

router.get('/accounts', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM accounts WHERE is_active = TRUE ORDER BY code')).rows); } catch (e) { next(e); }
});

router.get('/parties', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM parties ORDER BY name')).rows); } catch (e) { next(e); }
});

router.post('/parties', validate(partySchema), async (req, res, next) => {
  try {
    const { name, type = 'customer', email, phone, address } = req.body || {};
    const r = await query('INSERT INTO parties (name, type, email, phone, address) VALUES ($1,$2,$3,$4,$5) RETURNING *', [name, type, email, phone, address]);
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

router.get('/tax-rates', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM tax_rates ORDER BY name')).rows); } catch (e) { next(e); }
});

router.get('/journal-entries', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM journal_entries ORDER BY entry_date DESC, id DESC')).rows); } catch (e) { next(e); }
});

router.get('/invoices', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM invoices ORDER BY issue_date DESC, id DESC')).rows); } catch (e) { next(e); }
});

router.get('/payments', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM payments ORDER BY payment_date DESC, id DESC')).rows); } catch (e) { next(e); }
});

router.post('/actions/post-entry', validate(postEntrySchema), async (req, res, next) => {
  try {
    const entry = await journal.postJournalEntry(req.body || {});
    res.status(201).json(entry);
  } catch (e) { handleError(res, e); }
});

router.post('/actions/create-invoice', validate(createInvoiceSchema), async (req, res, next) => {
  try {
    const result = await createInvoice(req.body || {});
    res.status(201).json(result);
  } catch (e) { handleError(res, e); }
});

router.post('/actions/record-payment', validate(recordPaymentSchema), async (req, res, next) => {
  try {
    const result = await recordPayment(req.body || {});
    res.status(201).json(result);
  } catch (e) { handleError(res, e); }
});

router.post('/actions/reverse-entry', validate(reverseEntrySchema), async (req, res, next) => {
  try {
    const { entryId } = req.body || {};
    const result = await journal.reverseEntry(entryId);
    res.status(201).json(result);
  } catch (e) { handleError(res, e); }
});

router.get('/reports/trial-balance', async (req, res, next) => {
  try { res.json(await reports.trialBalance()); } catch (e) { next(e); }
});
router.get('/reports/profit-and-loss', async (req, res, next) => {
  try { res.json(await reports.profitAndLoss(req.query.start as string, req.query.end as string)); } catch (e) { next(e); }
});
router.get('/reports/balance-sheet', async (req, res, next) => {
  try { res.json(await reports.balanceSheet(req.query.as_of as string)); } catch (e) { next(e); }
});
router.get('/reports/cash-flow', async (req, res, next) => {
  try { res.json(await reports.cashFlow(req.query.start as string, req.query.end as string)); } catch (e) { next(e); }
});
router.get('/reports/aged-receivables', async (req, res, next) => {
  try { res.json(await reports.agedReceivables(req.query.as_of as string)); } catch (e) { next(e); }
});
router.get('/reports/aged-payables', async (req, res, next) => {
  try { res.json(await reports.agedPayables(req.query.as_of as string)); } catch (e) { next(e); }
});
router.get('/reports/vat-return', async (req, res, next) => {
  try { res.json(await reports.vatReturn(req.query.start as string, req.query.end as string)); } catch (e) { next(e); }
});
router.get('/reports/budget-variance', async (req, res, next) => {
  try { res.json(await reports.budgetVariance(req.query.start as string, req.query.end as string)); } catch (e) { next(e); }
});
router.get('/reports/general-ledger', async (req, res, next) => {
  try { res.json(await reports.generalLedger(req.query.start as string, req.query.end as string)); } catch (e) { next(e); }
});
router.get('/reports/account-ledger', async (req, res, next) => {
  try {
    if (!req.query.account) return res.status(400).json({ error: 'account code required' });
    res.json(await reports.accountLedger(req.query.account as string, req.query.start as string, req.query.end as string));
  } catch (e) { next(e); }
});
router.get('/reports/party-statement', async (req, res, next) => {
  try {
    if (!req.query.party) return res.status(400).json({ error: 'party id required' });
    res.json(await reports.partyStatement(Number(req.query.party), req.query.start as string, req.query.end as string));
  } catch (e) { next(e); }
});
router.get('/reports/financial-ratios', async (req, res, next) => {
  try { res.json(await reports.financialRatios(req.query.as_of as string)); } catch (e) { next(e); }
});

router.get('/departments', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM departments ORDER BY name')).rows); } catch (e) { next(e); }
});

router.post('/departments', validate(departmentSchema), async (req, res, next) => {
  try {
    const { name } = req.body;
    const r = await query('INSERT INTO departments (name) VALUES ($1) RETURNING *', [name]);
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

router.get('/fixed-assets', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM fixed_assets ORDER BY purchase_date, id')).rows); } catch (e) { next(e); }
});

router.post('/fixed-assets', validate(fixedAssetSchema), async (req, res, next) => {
  try {
    const { name, accountId, purchaseDate, cost, salvageValue, usefulLifeYears } = req.body;
    const r = await query(
      'INSERT INTO fixed_assets (name, account_id, purchase_date, cost, salvage_value, useful_life_years) VALUES ($1,$2,$3::date,$4,$5,$6) RETURNING *',
      [name, accountId, purchaseDate, cost, salvageValue, usefulLifeYears],
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

router.get('/reports/profit-and-loss-by-department', async (req, res, next) => {
  try { res.json(await reports.profitAndLossByDepartment(req.query.start as string, req.query.end as string)); } catch (e) { next(e); }
});
router.get('/reports/fixed-asset-register', async (req, res, next) => {
  try { res.json(await reports.fixedAssetRegister(req.query.as_of as string)); } catch (e) { next(e); }
});
router.get('/reports/comparative-profit-and-loss', async (req, res, next) => {
  try {
    const start = (req.query.start as string) || '2026-01-01';
    const end = (req.query.end as string) || new Date().toISOString().slice(0, 10);
    res.json(await reports.comparativeProfitAndLoss(start, end));
  } catch (e) { next(e); }
});
router.get('/reports/changes-in-equity', async (req, res, next) => {
  try { res.json(await reports.changesInEquity(req.query.start as string, req.query.end as string)); } catch (e) { next(e); }
});

router.get('/inventory-items', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM inventory_items ORDER BY sku')).rows); } catch (e) { next(e); }
});
router.post('/inventory-items', validate(inventoryItemSchema), async (req, res, next) => {
  try {
    const { sku, name, unit } = req.body;
    const r = await query('INSERT INTO inventory_items (sku, name, unit) VALUES ($1,$2,$3) RETURNING *', [sku, name, unit]);
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});
router.get('/stock-movements', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM stock_movements ORDER BY movement_date DESC, id DESC')).rows); } catch (e) { next(e); }
});
router.post('/stock-movements', validate(stockMovementSchema), async (req, res, next) => {
  try {
    const { itemId, movementDate, quantity, unitCost, reference } = req.body;
    const r = await query('INSERT INTO stock_movements (item_id, movement_date, quantity, unit_cost, reference) VALUES ($1,$2::date,$3,$4,$5) RETURNING *', [itemId, movementDate, quantity, unitCost, reference]);
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

router.get('/bank-transactions', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM bank_transactions ORDER BY transaction_date DESC, id DESC')).rows); } catch (e) { next(e); }
});
router.post('/bank-transactions', validate(bankTransactionSchema), async (req, res, next) => {
  try {
    const { accountId, transactionDate, description, amount, reference } = req.body;
    const r = await query('INSERT INTO bank_transactions (account_id, transaction_date, description, amount, reference) VALUES ($1,$2::date,$3,$4,$5) RETURNING *', [accountId, transactionDate, description, amount, reference]);
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

router.get('/recurring-entries', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM recurring_entries ORDER BY next_run_date, id')).rows); } catch (e) { next(e); }
});
router.post('/recurring-entries', validate(recurringEntrySchema), async (req, res, next) => {
  try { res.status(201).json(await createRecurringEntry(req.body)); } catch (e) { next(e); }
});
router.post('/actions/process-recurring', async (req, res, next) => {
  try {
    const asOf = (req.body && req.body.asOfDate) || new Date().toISOString().slice(0, 10);
    res.json({ posted: await processRecurringEntries(asOf) });
  } catch (e) { next(e); }
});

router.post('/actions/close-year', validate(closeYearSchema), async (req, res, next) => {
  try { res.status(201).json(await closeYear(req.body.year)); } catch (e) { handleError(res, e); }
});

router.get('/reports/inventory-valuation', async (req, res, next) => {
  try { res.json(await reports.inventoryValuation()); } catch (e) { next(e); }
});
router.get('/reports/bank-reconciliation', async (req, res, next) => {
  try {
    if (!req.query.account) return res.status(400).json({ error: 'account code required' });
    res.json(await reports.bankReconciliation(req.query.account as string, req.query.as_of as string));
  } catch (e) { next(e); }
});

export default router;
